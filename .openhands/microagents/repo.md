Repository purpose
- Production-ready NestJS backend for BRICS Pay enabling buy/sell and on-chain withdrawals for BTC, ETH, and USDT_TRC20 via the real Bybit API, while preserving existing SOM↔ESOM and internal transfer flows.
- Exposes REST APIs for user profile and wallets, universal conversion (ESOM↔Crypto, Crypto↔Crypto, SOM↔ESOM), transfers, and admin settings.
- Uses Prisma (PostgreSQL) and integrates with an Ethereum RPC for ESOM token operations and a BRICS Internet Banking portal for SOM operations.

General setup
- Runtime: Node.js 20, NestJS 11, TypeScript 5.
- Database: PostgreSQL via Prisma. Migrations are applied automatically in Docker entrypoint (prisma migrate deploy).
- Environment:
  - Required: DATABASE_URL; BRICS_API_ROOT; RPC_URL; TOKEN_ADDRESS; ADMIN_ADDRESS; ADMIN_PRIVATE_KEY; PLATFORM_FEE
  - Bybit: BYBIT_API_KEY, BYBIT_API_SECRET, optional BYBIT_BASE_URL
  - For local Docker DB from host, set POSTGRES_HOST=host.docker.internal in .env
- Local development:
  - npm install
  - npx prisma generate
  - Ensure Postgres is up (docker compose up postgres) and DATABASE_URL is correct
  - npx prisma migrate dev --name init (or use docker entrypoint which runs migrate deploy)
  - npm run start:dev (default port 8000)
- Docker:
  - docker compose up (postgres and pgadmin). The app image builds via Dockerfile; entrypoint waits for DB, runs prisma migrate deploy, then starts app.
- Tooling:
  - Swagger at /api (x-api-key header if enabled)
  - Linting/formatting: ESLint + Prettier (npm run lint, npm run format)
  - Tests: Jest (npm test). No CI configured.

Repository structure (key paths)
- src/
  - app.module.ts, main.ts: bootstrap and global config
  - common/: shared DTOs, guards (BasicAuthGuard), helpers
  - config/
    - exchange/: BybitExchangeService (v5 REST) and interfaces for market buy/sell, USD tickers, and on-chain withdraw
    - settings/: SettingsService + module (DB-backed singleton settings with fees, rates, mins)
    - ethereum/: EthereumService (addresses, ESOM transfers, fiat↔token flows)
    - brics/: BricsService (auth and SOM operations via InternetBanking portal)
    - swagger/: middleware and Swagger setup
  - users/: UsersService computes buy_rate/sell_rate in ESOM for BTC/ETH/USDT_TRC20 using Bybit USD prices × Settings.esom_per_usd and per-asset fee pct; balances from UserAssetBalance
  - payments/: PaymentsService
    - convert(): universal ESOM↔Crypto, Crypto↔Crypto, SOM↔ESOM orchestration
    - withdrawCrypto(): enforces Settings mins and fixed fees; debits internal balance; calls Bybit withdraw; records WithdrawRequest
    - transfer(): routes BTC/ETH/USDT_TRC20 to withdrawCrypto; SOM/ESOM use existing flows
  - admin-management/: GET/PUT /admin-management/settings for Settings
  - transactions/, user-management/, blockchain-config/: supporting modules
- prisma/
  - schema.prisma with enums Asset, WithdrawStatus; models: Customer, Settings, UserAssetBalance, UserTrade, WithdrawRequest
  - migrations/ with initial table creation; entrypoint applies deploy
- DevOps: Dockerfile, docker-compose*.yaml (postgres, pgadmin), entrypoint.sh (waits for DB, runs migrations), Makefile
- Config: eslint.config.mjs, .prettierrc, tsconfig*.json, nest-cli.json, package.json scripts

CI and GitHub workflows
- .github/ not found. No GitHub Actions workflows present.
- Quality tools available locally: ESLint, Prettier, Jest.

Last reviewed: 2025-09-22
