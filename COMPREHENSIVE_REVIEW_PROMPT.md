# Comprehensive Codebase Review Prompt

## Objective
Perform an exhaustive, rigorous review of the Codenames Online codebase from every relevant perspective. Leave no stone unturned. Identify, categorize, prioritize, and fix all issues found.

---

## Review Categories

### 1. SECURITY AUDIT (Critical Priority)

#### 1.1 Authentication & Authorization
- [ ] JWT implementation correctness (secret strength, algorithm, expiration)
- [ ] Token storage and transmission security
- [ ] Session management vulnerabilities
- [ ] Permission checks on all protected endpoints
- [ ] Role-based access control implementation
- [ ] Socket.io authentication middleware completeness

#### 1.2 Input Validation & Sanitization
- [ ] All user inputs validated with Zod schemas
- [ ] SQL injection prevention (parameterized queries)
- [ ] NoSQL injection prevention
- [ ] XSS prevention (output encoding)
- [ ] Command injection prevention
- [ ] Path traversal prevention
- [ ] SSRF prevention
- [ ] Prototype pollution prevention

#### 1.3 Rate Limiting & DoS Protection
- [ ] Rate limiting on all public endpoints
- [ ] Rate limiting on WebSocket events
- [ ] Memory exhaustion prevention
- [ ] Request size limits
- [ ] Connection limits per IP

#### 1.4 CORS & CSRF
- [ ] CORS configuration correctness
- [ ] CSRF token implementation
- [ ] SameSite cookie attributes
- [ ] Origin validation

#### 1.5 Secrets Management
- [ ] No hardcoded secrets in code
- [ ] Environment variable validation
- [ ] Secrets not logged
- [ ] .env files in .gitignore

#### 1.6 Dependency Security
- [ ] No known vulnerabilities (npm audit)
- [ ] Dependencies up to date
- [ ] No unnecessary dependencies
- [ ] Lock file integrity

#### 1.7 Security Headers
- [ ] Helmet.js configuration completeness
- [ ] Content-Security-Policy
- [ ] X-Frame-Options
- [ ] X-Content-Type-Options
- [ ] Referrer-Policy

---

### 2. CODE QUALITY & BEST PRACTICES

#### 2.1 JavaScript/Node.js Best Practices
- [ ] Consistent coding style (ESLint compliance)
- [ ] Proper async/await usage (no unhandled promises)
- [ ] No callback hell
- [ ] Proper error propagation
- [ ] Memory leak prevention
- [ ] Event listener cleanup

#### 2.2 Code Organization
- [ ] Single Responsibility Principle
- [ ] DRY (Don't Repeat Yourself)
- [ ] Proper module boundaries
- [ ] Clear separation of concerns
- [ ] Consistent file naming conventions

#### 2.3 Error Handling
- [ ] All async operations have error handling
- [ ] Proper error types and messages
- [ ] Errors logged appropriately
- [ ] User-friendly error responses
- [ ] No sensitive data in error messages

#### 2.4 Code Smells
- [ ] No dead code
- [ ] No commented-out code
- [ ] No magic numbers/strings (use constants)
- [ ] No overly complex functions (cyclomatic complexity)
- [ ] No deeply nested callbacks/conditionals

#### 2.5 Documentation
- [ ] JSDoc comments on public APIs
- [ ] README accuracy and completeness
- [ ] API documentation accuracy
- [ ] Code comments where necessary (not obvious)

---

### 3. PERFORMANCE ANALYSIS

#### 3.1 Backend Performance
- [ ] N+1 query prevention
- [ ] Proper database indexing
- [ ] Connection pooling configuration
- [ ] Redis caching effectiveness
- [ ] Memory usage patterns
- [ ] CPU-intensive operations offloaded

#### 3.2 Frontend Performance
- [ ] Bundle size optimization
- [ ] Lazy loading implementation
- [ ] Image optimization
- [ ] DOM manipulation efficiency
- [ ] Event handler efficiency
- [ ] Memory leaks in SPA

#### 3.3 WebSocket Performance
- [ ] Message size optimization
- [ ] Unnecessary broadcasts prevention
- [ ] Connection management efficiency
- [ ] Heartbeat configuration

#### 3.4 Caching Strategy
- [ ] Appropriate cache TTLs
- [ ] Cache invalidation correctness
- [ ] Cache key design

---

### 4. CONCURRENCY & RACE CONDITIONS

#### 4.1 Database Operations
- [ ] Transaction usage where needed
- [ ] Optimistic/pessimistic locking
- [ ] Deadlock prevention

#### 4.2 Redis Operations
- [ ] Atomic operations (Lua scripts)
- [ ] Distributed lock implementation
- [ ] Race condition prevention in game state

#### 4.3 WebSocket Events
- [ ] Event ordering guarantees
- [ ] State synchronization correctness
- [ ] Reconnection handling

---

### 5. TESTING QUALITY

#### 5.1 Test Coverage
- [ ] Unit test coverage meets threshold (70%+)
- [ ] Critical paths have integration tests
- [ ] E2E tests cover main user flows
- [ ] Edge cases tested

#### 5.2 Test Quality
- [ ] Tests are deterministic (no flaky tests)
- [ ] Tests are isolated (no shared state)
- [ ] Mocks are appropriate
- [ ] Assertions are meaningful
- [ ] Test descriptions are clear

#### 5.3 Test Organization
- [ ] Tests organized by feature/module
- [ ] Helper functions reused
- [ ] Setup/teardown proper

---

### 6. API DESIGN

#### 6.1 REST API
- [ ] Consistent endpoint naming
- [ ] Proper HTTP methods usage
- [ ] Appropriate status codes
- [ ] Consistent response format
- [ ] Pagination implementation
- [ ] Filtering/sorting capabilities

#### 6.2 WebSocket API
- [ ] Event naming consistency
- [ ] Event payload structure consistency
- [ ] Acknowledgment handling
- [ ] Error event format

#### 6.3 Versioning & Compatibility
- [ ] API versioning strategy
- [ ] Backward compatibility considerations

---

### 7. DATABASE DESIGN

#### 7.1 Schema Design
- [ ] Proper normalization
- [ ] Appropriate data types
- [ ] Required constraints
- [ ] Foreign key relationships
- [ ] Index strategy

#### 7.2 Prisma Usage
- [ ] Efficient queries
- [ ] Proper relation loading
- [ ] Migration strategy

---

### 8. CONFIGURATION & ENVIRONMENT

#### 8.1 Environment Variables
- [ ] All configurable values externalized
- [ ] Proper defaults for development
- [ ] Validation of required variables
- [ ] Documentation of all variables

#### 8.2 Docker Configuration
- [ ] Multi-stage builds optimized
- [ ] Security best practices (non-root user)
- [ ] Health checks configured
- [ ] Resource limits set

#### 8.3 Production Readiness
- [ ] Logging configured for production
- [ ] Graceful shutdown implemented
- [ ] Health endpoints available
- [ ] Metrics exposed

---

### 9. SCALABILITY & RELIABILITY

#### 9.1 Horizontal Scaling
- [ ] Stateless server design
- [ ] Redis Pub/Sub for multi-instance
- [ ] Sticky sessions if needed

#### 9.2 Fault Tolerance
- [ ] Graceful degradation (optional deps)
- [ ] Retry logic with backoff
- [ ] Circuit breaker patterns
- [ ] Timeout configuration

#### 9.3 Monitoring & Observability
- [ ] Structured logging
- [ ] Correlation IDs
- [ ] Metrics collection
- [ ] Error tracking

---

### 10. FRONTEND SPECIFIC

#### 10.1 Accessibility (WCAG 2.1)
- [ ] Keyboard navigation
- [ ] Screen reader compatibility
- [ ] Color contrast
- [ ] Focus management
- [ ] ARIA attributes

#### 10.2 Browser Compatibility
- [ ] Modern browser support
- [ ] Graceful degradation for older browsers
- [ ] Mobile responsiveness

#### 10.3 State Management
- [ ] Predictable state updates
- [ ] State synchronization with server
- [ ] Offline handling

---

### 11. SPECIFIC FILE REVIEWS

#### Critical Files to Review:
1. `server/src/services/gameService.js` - Core game logic
2. `server/src/services/roomService.js` - Room management
3. `server/src/services/playerService.js` - Player management
4. `server/src/services/timerService.js` - Timer logic
5. `server/src/socket/handlers/*.js` - All WebSocket handlers
6. `server/src/middleware/*.js` - All middleware
7. `server/src/config/*.js` - All configuration
8. `server/src/validators/schemas.js` - Input validation
9. `index.html` - Frontend application
10. `server/src/app.js` - Express setup
11. `server/src/socket/index.js` - Socket.io setup

---

## Review Process

### Phase 1: Automated Analysis
1. Run `npm audit` for dependency vulnerabilities
2. Run ESLint for code quality issues
3. Run tests to verify baseline
4. Check test coverage report

### Phase 2: Manual Code Review
1. Review each critical file systematically
2. Check for patterns from the categories above
3. Document all findings with severity levels

### Phase 3: Fix Prioritization
- **Critical**: Security vulnerabilities, data loss risks
- **High**: Bugs, performance issues affecting users
- **Medium**: Code quality issues, minor bugs
- **Low**: Style issues, documentation gaps

### Phase 4: Implementation
1. Create fixes for each issue
2. Ensure tests pass after fixes
3. Document changes made

---

## Output Format

For each issue found:
```
### Issue: [Brief Description]
- **Category**: [Security/Performance/Quality/etc.]
- **Severity**: [Critical/High/Medium/Low]
- **File**: [file path:line number]
- **Description**: [Detailed explanation]
- **Fix**: [Proposed or implemented fix]
- **Status**: [Found/Fixed]
```

---

## Execution Checklist

- [ ] Phase 1: Automated Analysis Complete
- [ ] Phase 2: Security Audit Complete
- [ ] Phase 3: Code Quality Review Complete
- [ ] Phase 4: Performance Analysis Complete
- [ ] Phase 5: Testing Review Complete
- [ ] Phase 6: API Design Review Complete
- [ ] Phase 7: All Critical Fixes Implemented
- [ ] Phase 8: Tests Pass After Fixes
- [ ] Phase 9: Documentation Updated
