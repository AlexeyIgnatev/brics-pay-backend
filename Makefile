run-dev:
	docker compose -f ./docker-compose.yaml up --build -d
run-prod:
	docker compose -f ./docker-compose.production.yaml --env-file .env.production up --build -d

stop-dev:
	docker compose -f ./docker-compose.yaml down 
stop-prod:
	docker compose -f ./docker-compose.production.yaml down 

