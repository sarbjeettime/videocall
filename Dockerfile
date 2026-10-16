# Stage 1: Compute dependency recipe for caching
FROM lukemathwalker/cargo-chef:latest-rust-1 AS chef
WORKDIR /app

FROM chef AS planner
COPY . .
RUN cargo chef prepare --recipe-path recipe.json

# Stage 2: Build dependencies + binary
FROM chef AS builder
COPY --from=planner /app/recipe.json recipe.json
# Build dependencies (cached as long as Cargo.toml/Cargo.lock don't change)
RUN cargo chef cook --release --recipe-path recipe.json
# Copy source code and build the app
COPY . .
RUN cargo build --release --bin codechat

# Stage 3: Minimal runtime image
FROM debian:bookworm-slim
WORKDIR /app

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    libssl3 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy the compiled binary
COPY --from=builder /app/target/release/codechat /app/codechat

# Copy static frontend files
COPY public/ /app/public/

# Railway sets PORT env var automatically
EXPOSE 3000

CMD ["./codechat"]
