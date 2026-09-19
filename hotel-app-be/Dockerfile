# Multi-stage Dockerfile for Rust Backend
# Stage 1: Build the application
FROM rust:1.95.0-bookworm AS builder

# Install build dependencies
# protobuf-compiler: build.rs compiles the gRPC contract in ./proto via protoc
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    libpq-dev \
    musl-tools \
    protobuf-compiler \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy Cargo files first for better layer caching
# build.rs + proto/: the build script runs protoc codegen on first build
COPY Cargo.toml Cargo.lock build.rs ./
COPY proto ./proto

# Create a dummy main.rs and lib.rs to build dependencies
RUN mkdir src && \
    echo "fn main() {}" > src/main.rs && \
    touch src/lib.rs && \
    cargo build --release && \
    rm -rf src

# Copy the actual source code
COPY src ./src

# Build the application
# Refresh every source mtime: cargo may otherwise treat copied files as fresh
# and keep the dependency-layer stubs — with the bin linking hotel_app_be, a
# stale stub lib.rs fails with unresolved imports (broke deploy 2026-09-19).
RUN find src -type f -exec touch {} + && \
    cargo build --release && \
    strip target/release/hotel-app-be

# Stage 2: Create the runtime image
FROM debian:bookworm-slim

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    ca-certificates \
    libpq5 \
    libssl3 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd -m -u 1000 -s /bin/bash appuser

# Create app directory
WORKDIR /app

# Copy the binary from builder
COPY --from=builder /app/target/release/hotel-app-be /app/hotel-app-be

# Create logs directory
RUN mkdir -p /app/logs && chown -R appuser:appuser /app

# Switch to non-root user
USER appuser

# Expose the port
EXPOSE 3030

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:3030/health || exit 1

# Run the application
CMD ["/app/hotel-app-be"]
