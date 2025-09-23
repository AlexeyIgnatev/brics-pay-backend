Repository purpose
- Backend service for BRICS Pay integrating fiat banking operations with crypto token flows.
- Provides REST APIs for user info, payments (fiat↔crypto, transfers), and admin/transaction views.
- Uses NestJS + Prisma (PostgreSQL) and integrates with an Ethereum-like RPC and an external BRICS Internet Banking web portal.

General setup
- Runtime: Node.js 20, NestJS 11, TypeScript 5.
- Database: PostgreSQL via Prisma. Prisma schema defines Customer model and migrations are included.
- Env config: copy .env.example to .env and set values (DATABASE_URL, BRICS_API_ROOT, RPC_URL, TOKEN_ADDRESS, ADMIN_ADDRESS, PRIVATE_ADMIN_KEY, PLATFORM_FEE, etc.).
- Local dev:
  - npm install
  - npx prisma generate
  - Ensure Postgres is running (docker compose up postgres) and DATABASE_URL points to it
  - npm run start:dev (app listens on PORT or 8000)
- Docker/dev services: docker-compose.yaml provides postgres and pgadmin; Makefile targets run-dev/stop-dev. Production compose builds the app + postgres (Makefile run-prod/stop-prod).
- Swagger: available at /api; versioning enabled via URI.
- Testing: Jest configured; npm test, npm run test:watch, npm run test:e2e.
- Linting/formatting: ESLint + Prettier (scripts: npm run lint, npm run format).

Repository structure (key paths)
- src/
  - app.module.ts, main.ts: NestJS bootstrap, global pipes, CORS, versioning, Swagger setup.
  - common/: shared DTOs, base controller factory, guards (BasicAuthGuard), and helpers.
  - config/:
    - prisma/: PrismaService (connects on module init)
    - ethereum/: EthereumService (Web3 integration, address generation, token transfers, fiat↔token flows)
    - brics/: BricsService (axios + cheerio scraping/requests to BRICS InternetBanking, auth, create/find operations)
    - redis/: RedisService (ioredis client wrapper)
    - swagger/: Swagger configuration
  - users/: UsersController, UsersService, user DTOs/enums
  - payments/: PaymentsController/Service for fiat-to-crypto, crypto-to-fiat, and transfers (ESOM/SOM); integrates Prisma, EthereumService, BricsService
  - transactions/: Controller with admin-oriented listings and lookups (stubbed/example responses)
  - admin-management/, user-management/, blockchain-config/: modules and DTOs for admin and configuration operations
- prisma/
  - schema.prisma (PostgreSQL datasource), migrations/ (initial migration)
- test/
  - e2e test setup and sample app test
- Dockerfile, docker-compose*.yaml, Makefile, entrypoint.sh (waits for DB, runs prisma migrate deploy, starts app)
- Config: eslint.config.mjs, .prettierrc, tsconfig*.json, nest-cli.json

CI and GitHub workflows
- No .github/ directory found; no GitHub Actions workflows present in this repository.
- Local quality tools: ESLint (eslint.config.mjs) and Prettier (.prettierrc). Jest for tests defined in package.json.

Last reviewed: 2025-09-22
