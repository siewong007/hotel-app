# Multi-stage build for Rust backend
FROM rust:latest as builder

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Copy dependency files
COPY Cargo.toml Cargo.lock ./

# Create a dummy src/main.rs to build dependencies
RUN mkdir src && echo "fn main() {}" > src/main.rs

# Build dependencies (this layer will be cached)
RUN cargo build --release || true
RUN rm src/main.rs

# Copy actual source code
COPY src ./src

# Build the application
RUN cargo build --release

# Rename binary to a consistent name (handle both hyphen and underscore variants)
RUN if [ -f /app/target/release/hotel-management-be ]; then \
        cp /app/target/release/hotel-management-be /app/target/release/hotel_management_be; \
    fi

# Runtime stage
FROM debian:bookworm-slim

WORKDIR /app

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    ca-certificates \
    libssl3 \
    && rm -rf /var/lib/apt/lists/*

# Copy the binary from builder
COPY --from=builder /app/target/release/hotel_management_be /app/hotel_management_be

# Expose port
EXPOSE 3030

# Run the application
CMD ["./hotel_management_be"]

