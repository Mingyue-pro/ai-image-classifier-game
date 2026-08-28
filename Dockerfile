FROM node:24-slim AS frontend-build

WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    AI_IMAGE_GAME_FRONTEND_DIST=/app/frontend/dist

WORKDIR /app
COPY backend/requirements.txt /tmp/backend-requirements.txt
RUN python -m pip install --no-cache-dir -r /tmp/backend-requirements.txt
COPY . /app
COPY --from=frontend-build /frontend/dist /app/frontend/dist

CMD ["python", "-m", "scripts.production_start"]
