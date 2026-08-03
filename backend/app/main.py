"""
FastAPI application entry point loaded by Uvicorn.
"""
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.app.database import initialize_database
from backend.app.routes.classify import router as classify_router
from backend.app.routes.exports import router as export_router
from backend.app.routes.game import router as game_router
from backend.app.routes.research import router as research_router


@asynccontextmanager
async def lifespan(application: FastAPI) -> AsyncIterator[None]:
    """Initialize persistent tables before the API accepts requests."""
    del application
    initialize_database()
    yield


# Create FastAPI app
app = FastAPI(
    title="AI Image Classifier Game API",
    version="0.1.0",
    lifespan=lifespan,
)

# Configure frontend cross-origin access
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register /classify router
app.include_router(classify_router)
app.include_router(research_router)
app.include_router(game_router)
app.include_router(export_router)


@app.get("/")
def read_root() -> dict[str, str]:
    return {"message": "AI Image Classifier Game API"}


@app.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}
