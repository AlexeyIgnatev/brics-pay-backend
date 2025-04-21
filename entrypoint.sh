#!/bin/bash

host=$(echo "$POSTGRES_HOST")
port=$(echo "$POSTGRES_PORT")

# Ждем, пока база данных будет доступна на порту 5432
until nc -z -v -w30 "$host" "$port"; do
	echo "Waiting for database connection..."
	sleep 1
done

# Когда база данных доступна, выполняем миграции и запускаем приложение
echo "Database is up, running prisma migrate deploy"
npx prisma migrate deploy

# Запускаем приложение
exec npm run start:prod
