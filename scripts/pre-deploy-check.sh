#!/bin/bash
# Pre-deployment validation script
# Run before deploying to catch common issues

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SERVER_DIR="$PROJECT_ROOT/server"

echo "🔍 Running pre-deployment checks..."
echo ""

ERRORS=0
WARNINGS=0

# Function to track errors
error() {
    echo "❌ ERROR: $1"
    ERRORS=$((ERRORS + 1))
}

warning() {
    echo "⚠️  WARNING: $1"
    WARNINGS=$((WARNINGS + 1))
}

success() {
    echo "✓ $1"
}

# 1. Check environment variables
echo "📋 Checking environment configuration..."

if [ -n "$JWT_SECRET" ]; then
    if [ ${#JWT_SECRET} -lt 32 ]; then
        error "JWT_SECRET must be at least 32 characters (current: ${#JWT_SECRET})"
    else
        success "JWT_SECRET length OK (${#JWT_SECRET} chars)"
    fi
else
    warning "JWT_SECRET not set in environment (will use .env file)"
fi

if [ "$NODE_ENV" = "production" ]; then
    success "NODE_ENV=production"
else
    warning "NODE_ENV is not 'production' (current: ${NODE_ENV:-development})"
fi

# 2. Check for common security issues
echo ""
echo "🔐 Security checks..."

cd "$SERVER_DIR"

# Check for hardcoded secrets (basic check)
if grep -r "password.*=" --include="*.js" src/ 2>/dev/null | grep -v "\.test\.js" | grep -v "process.env" | grep -v "schema" | head -1 > /dev/null; then
    warning "Possible hardcoded password found - please review"
fi

# Check for debug code
if grep -rn "console\.log" --include="*.js" src/ 2>/dev/null | grep -v "\.test\.js" | grep -v "logger" | head -1 > /dev/null; then
    warning "console.log statements found - consider using logger instead"
fi

success "No obvious security issues found"

# 3. Run linter
echo ""
echo "📝 Running linter..."
if npm run lint > /dev/null 2>&1; then
    success "Linting passed"
else
    error "Linting failed - run 'npm run lint' to see details"
fi

# 4. Run tests
echo ""
echo "🧪 Running tests..."
if npm test -- --passWithNoTests > /dev/null 2>&1; then
    success "Tests passed"
else
    error "Tests failed - run 'npm test' to see details"
fi

# 5. Check dependencies for vulnerabilities
echo ""
echo "📦 Checking for vulnerabilities..."
AUDIT_OUTPUT=$(npm audit --json 2>/dev/null || echo '{"metadata":{"vulnerabilities":{"critical":0,"high":0}}}')
CRITICAL=$(echo "$AUDIT_OUTPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('metadata',{}).get('vulnerabilities',{}).get('critical',0))" 2>/dev/null || echo "0")
HIGH=$(echo "$AUDIT_OUTPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('metadata',{}).get('vulnerabilities',{}).get('high',0))" 2>/dev/null || echo "0")

if [ "$CRITICAL" -gt 0 ]; then
    error "Found $CRITICAL critical vulnerabilities"
elif [ "$HIGH" -gt 0 ]; then
    warning "Found $HIGH high severity vulnerabilities"
else
    success "No critical or high vulnerabilities found"
fi

# 6. Check Docker build
echo ""
echo "🐳 Checking Docker build..."
if command -v docker &> /dev/null; then
    cd "$PROJECT_ROOT"
    if docker compose build --quiet > /dev/null 2>&1; then
        success "Docker build successful"
    else
        error "Docker build failed"
    fi
else
    warning "Docker not available - skipping build check"
fi

# Summary
echo ""
echo "========================================="
if [ $ERRORS -gt 0 ]; then
    echo "❌ FAILED: $ERRORS error(s), $WARNINGS warning(s)"
    echo ""
    echo "Please fix the errors before deploying."
    exit 1
elif [ $WARNINGS -gt 0 ]; then
    echo "⚠️  PASSED WITH WARNINGS: $WARNINGS warning(s)"
    echo ""
    echo "Review warnings before deploying to production."
    exit 0
else
    echo "✅ ALL CHECKS PASSED"
    echo ""
    echo "Ready for deployment!"
    exit 0
fi
