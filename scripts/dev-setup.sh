#!/bin/bash
# Development environment setup script
# Run this once to set up your local development environment

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "🚀 Setting up Eigennamen development environment..."

# Check Node.js version
NODE_VERSION=$(node -v 2>/dev/null | cut -d'v' -f2 | cut -d'.' -f1)
if [ -z "$NODE_VERSION" ] || [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js 18+ is required. Current version: $(node -v 2>/dev/null || echo 'not installed')"
    exit 1
fi
echo "✓ Node.js version: $(node -v)"

# Install server dependencies
echo "📦 Installing server dependencies..."
cd "$PROJECT_ROOT/server"
npm ci

# Create .env if missing
if [ ! -f .env ]; then
    echo "📝 Creating .env file from template..."
    if [ -f .env.example ]; then
        cp .env.example .env
        # Generate secure JWT secret
        JWT_SECRET=$(openssl rand -hex 32 2>/dev/null || node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
        if [[ "$OSTYPE" == "darwin"* ]]; then
            sed -i '' "s/your-development-secret-key-change-in-production/$JWT_SECRET/" .env
        else
            sed -i "s/your-development-secret-key-change-in-production/$JWT_SECRET/" .env
        fi
        echo "✓ Generated secure JWT_SECRET"
    else
        echo "⚠️  No .env.example found, creating minimal .env"
        cat > .env << EOF
NODE_ENV=development
PORT=3000
REDIS_URL=memory
JWT_SECRET=$(openssl rand -hex 32 2>/dev/null || node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
EOF
    fi
else
    echo "✓ .env file already exists"
fi

# Check if Docker is available
if command -v docker &> /dev/null && command -v docker compose &> /dev/null; then
    echo "🐳 Docker detected, starting services..."
    cd "$PROJECT_ROOT"
    docker compose up -d --build

    echo "⏳ Waiting for services to be ready..."
    MAX_ATTEMPTS=30
    for i in $(seq 1 $MAX_ATTEMPTS); do
        if curl -sf http://localhost:3000/health > /dev/null 2>&1; then
            echo "✅ Development environment ready at http://localhost:3000"
            exit 0
        fi
        sleep 2
    done
    echo "⚠️  Services started but health check not responding yet"
else
    echo "ℹ️  Docker not available, using memory mode"
    echo "   Start the server with: cd server && npm run dev"
fi

echo ""
echo "✅ Setup complete! Next steps:"
echo "   cd server && npm run dev    # Start development server"
echo "   npm test                    # Run tests"
echo "   npm run lint                # Check code style"
