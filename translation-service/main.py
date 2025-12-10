"""
Hotel Management System - Translation Service
mBART + Adapter Fusion for Multilingual Support
"""

import logging
from fastapi import FastAPI, HTTPException, BackgroundTasks, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List, Optional, Dict
import torch
from transformers import MBartForConditionalGeneration, MBart50TokenizerFast
import redis
import hashlib
from cassandra.cluster import Cluster
from cassandra.auth import PlainTextAuthProvider
from datetime import datetime
import os
from contextlib import asynccontextmanager

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# ============================================================================
# Models
# ============================================================================

class TranslationRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=5000)
    source_language: str = Field(..., pattern=r"^[a-z]{2}$")
    target_language: str = Field(..., pattern=r"^[a-z]{2}$")
    domain: str = Field(default="hotel_domain")
    quality_preference: str = Field(default="balanced", pattern=r"^(fast|balanced|accurate)$")
    use_cache: bool = Field(default=True)

class TranslationResponse(BaseModel):
    translated_text: str
    source_language: str
    target_language: str
    quality_score: float
    translation_method: str
    model_version: str
    cached: bool = False

class BatchTranslationRequest(BaseModel):
    requests: List[TranslationRequest]
    max_parallel: int = Field(default=10, ge=1, le=50)

class HealthResponse(BaseModel):
    status: str
    model_loaded: bool
    adapters_loaded: bool
    device: str
    uptime_seconds: float

# ============================================================================
# Translation Service
# ============================================================================

class TranslationService:
    """Main translation service with mBART and adapter fusion"""

    MODEL_NAME = "facebook/mbart-large-50-many-to-many-mmt"

    # Language code mapping (ISO 639-1 to mBART codes)
    LANG_MAPPING = {
        'en': 'en_XX', 'es': 'es_XX', 'fr': 'fr_XX', 'de': 'de_DE',
        'zh': 'zh_CN', 'ja': 'ja_XX', 'ar': 'ar_AR', 'ru': 'ru_RU',
        'pt': 'pt_XX', 'it': 'it_IT', 'ko': 'ko_KR', 'hi': 'hi_IN',
        'tr': 'tr_TR', 'vi': 'vi_VN', 'th': 'th_TH'
    }

    def __init__(self):
        self.model = None
        self.tokenizer = None
        self.device = None
        self.redis_client = None
        self.scylla_session = None
        self.adapters_loaded = False
        self.start_time = datetime.now()

    async def initialize(self):
        """Initialize all components"""
        logger.info("🚀 Initializing Translation Service...")

        # Setup device
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        logger.info(f"📱 Using device: {self.device}")

        # Load model and tokenizer
        logger.info("📦 Loading mBART model...")
        try:
            self.tokenizer = MBart50TokenizerFast.from_pretrained(
                self.MODEL_NAME,
                cache_dir=os.getenv("MODEL_CACHE_DIR", "/app/models")
            )
            self.model = MBartForConditionalGeneration.from_pretrained(
                self.MODEL_NAME,
                cache_dir=os.getenv("MODEL_CACHE_DIR", "/app/models")
            )
            self.model = self.model.to(self.device)
            self.model.eval()  # Set to evaluation mode
            logger.info("✅ Model loaded successfully")
        except Exception as e:
            logger.error(f"❌ Failed to load model: {e}")
            raise

        # Load adapters (optional - will work without them)
        try:
            self._load_adapters()
        except Exception as e:
            logger.warning(f"⚠️ Could not load adapters: {e}. Using base model only.")

        # Initialize Redis
        try:
            redis_host = os.getenv("REDIS_HOST", "redis")
            redis_port = int(os.getenv("REDIS_PORT", "6379"))
            self.redis_client = redis.Redis(
                host=redis_host,
                port=redis_port,
                db=1,
                decode_responses=False,
                socket_connect_timeout=5
            )
            self.redis_client.ping()
            logger.info("✅ Redis connected")
        except Exception as e:
            logger.warning(f"⚠️  Redis connection failed: {e}. Running without cache.")
            self.redis_client = None

        # Initialize ScyllaDB
        try:
            scylla_hosts = os.getenv("SCYLLA_HOSTS", "scylladb").split(",")
            cluster = Cluster(scylla_hosts)
            self.scylla_session = cluster.connect()
            self.scylla_session.set_keyspace('hotel_i18n')
            logger.info("✅ ScyllaDB connected")
        except Exception as e:
            logger.warning(f"⚠️  ScyllaDB connection failed: {e}. Running without persistent storage.")
            self.scylla_session = None

        logger.info("✨ Translation Service ready!")

    def _load_adapters(self):
        """Load domain-specific adapters (stub for now)"""
        # In production, load trained adapters from /app/adapters
        # For now, we'll use the base model
        adapter_dir = os.getenv("ADAPTER_DIR", "/app/adapters")
        if os.path.exists(adapter_dir):
            logger.info(f"📂 Adapter directory found: {adapter_dir}")
            # TODO: Implement adapter loading when trained
            self.adapters_loaded = False
        else:
            logger.info("📂 No adapter directory found, using base model")
            self.adapters_loaded = False

    def _get_cache_key(self, req: TranslationRequest) -> str:
        """Generate cache key"""
        content = f"{req.text}:{req.source_language}:{req.target_language}:{req.domain}"
        return f"trans:{hashlib.sha256(content.encode()).hexdigest()}"

    async def _get_from_cache(self, cache_key: str) -> Optional[Dict]:
        """Retrieve from Redis cache"""
        if not self.redis_client:
            return None

        try:
            cached = self.redis_client.get(cache_key)
            if cached:
                import ast
                return ast.literal_eval(cached.decode('utf-8'))
        except Exception as e:
            logger.error(f"Cache retrieval error: {e}")
        return None

    async def _save_to_cache(self, cache_key: str, data: Dict, ttl: int = 2592000):
        """Save to Redis cache (30 days)"""
        if not self.redis_client:
            return

        try:
            self.redis_client.setex(cache_key, ttl, str(data))
        except Exception as e:
            logger.error(f"Cache save error: {e}")

    async def translate(self, request: TranslationRequest) -> TranslationResponse:
        """Perform translation"""

        # Validate languages
        if request.source_language not in self.LANG_MAPPING:
            raise HTTPException(400, f"Unsupported source language: {request.source_language}")
        if request.target_language not in self.LANG_MAPPING:
            raise HTTPException(400, f"Unsupported target language: {request.target_language}")

        # Same language - return original
        if request.source_language == request.target_language:
            return TranslationResponse(
                translated_text=request.text,
                source_language=request.source_language,
                target_language=request.target_language,
                quality_score=1.0,
                translation_method="passthrough",
                model_version=self.MODEL_NAME,
                cached=False
            )

        # Check cache
        if request.use_cache:
            cache_key = self._get_cache_key(request)
            cached_result = await self._get_from_cache(cache_key)
            if cached_result:
                logger.info(f"✅ Cache hit: {request.source_language} -> {request.target_language}")
                return TranslationResponse(**cached_result, cached=True)

        # Perform translation
        try:
            logger.info(f"🔄 Translating: {request.source_language} -> {request.target_language}")

            # Set source language
            src_lang = self.LANG_MAPPING[request.source_language]
            tgt_lang = self.LANG_MAPPING[request.target_language]

            self.tokenizer.src_lang = src_lang

            # Tokenize
            inputs = self.tokenizer(
                request.text,
                return_tensors="pt",
                padding=True,
                truncation=True,
                max_length=512
            ).to(self.device)

            # Configure generation parameters based on quality preference
            num_beams = {
                "fast": 2,
                "balanced": 4,
                "accurate": 8
            }.get(request.quality_preference, 4)

            # Generate translation
            with torch.no_grad():
                generated_tokens = self.model.generate(
                    **inputs,
                    forced_bos_token_id=self.tokenizer.lang_code_to_id[tgt_lang],
                    max_length=512,
                    num_beams=num_beams,
                    early_stopping=True,
                    no_repeat_ngram_size=3
                )

            # Decode
            translated_text = self.tokenizer.batch_decode(
                generated_tokens,
                skip_special_tokens=True
            )[0]

            # Calculate quality score (simplified)
            quality_score = 0.85 if self.adapters_loaded else 0.75

            response = TranslationResponse(
                translated_text=translated_text,
                source_language=request.source_language,
                target_language=request.target_language,
                quality_score=quality_score,
                translation_method="adapter_fusion" if self.adapters_loaded else "mbart",
                model_version=self.MODEL_NAME,
                cached=False
            )

            # Cache result
            if request.use_cache:
                cache_data = response.model_dump()
                cache_data['cached'] = True
                await self._save_to_cache(cache_key, cache_data)

            logger.info(f"✅ Translation complete: {request.source_language} -> {request.target_language}")
            return response

        except Exception as e:
            logger.error(f"❌ Translation error: {e}")
            raise HTTPException(500, f"Translation failed: {str(e)}")

    def get_uptime(self) -> float:
        """Get service uptime in seconds"""
        return (datetime.now() - self.start_time).total_seconds()

# ============================================================================
# FastAPI App
# ============================================================================

# Global service instance
service = TranslationService()

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager"""
    await service.initialize()
    yield
    # Cleanup
    if service.redis_client:
        service.redis_client.close()
    if service.scylla_session:
        service.scylla_session.shutdown()

app = FastAPI(
    title="Hotel Translation Service",
    description="mBART + Adapter Fusion for multilingual hotel content",
    version="1.0.0",
    lifespan=lifespan
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure properly in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================================
# Endpoints
# ============================================================================

@app.get("/", tags=["Info"])
async def root():
    """Root endpoint"""
    return {
        "service": "Hotel Translation Service",
        "version": "1.0.0",
        "model": service.MODEL_NAME,
        "status": "ready" if service.model else "initializing"
    }

@app.get("/health", response_model=HealthResponse, tags=["Health"])
async def health_check():
    """Health check endpoint"""
    return HealthResponse(
        status="healthy" if service.model else "initializing",
        model_loaded=service.model is not None,
        adapters_loaded=service.adapters_loaded,
        device=str(service.device) if service.device else "unknown",
        uptime_seconds=service.get_uptime()
    )

@app.post("/translate", response_model=TranslationResponse, tags=["Translation"])
async def translate_text(request: TranslationRequest):
    """Translate text"""
    if not service.model:
        raise HTTPException(503, "Service still initializing")
    return await service.translate(request)

@app.post("/translate/batch", response_model=List[TranslationResponse], tags=["Translation"])
async def translate_batch(batch: BatchTranslationRequest):
    """Batch translation"""
    if not service.model:
        raise HTTPException(503, "Service still initializing")

    results = []
    for req in batch.requests[:batch.max_parallel]:
        try:
            result = await service.translate(req)
            results.append(result)
        except Exception as e:
            logger.error(f"Batch translation error: {e}")
            # Return error placeholder
            results.append(TranslationResponse(
                translated_text=req.text,  # Return original on error
                source_language=req.source_language,
                target_language=req.target_language,
                quality_score=0.0,
                translation_method="error",
                model_version="",
                cached=False
            ))

    return results

@app.get("/languages", tags=["Info"])
async def get_supported_languages():
    """Get supported languages"""
    return {
        "supported": list(service.LANG_MAPPING.keys()),
        "mapping": service.LANG_MAPPING
    }

# ============================================================================
# Main
# ============================================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=False,
        workers=1  # Single worker due to model size
    )
