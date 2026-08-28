"""
FastAPI application entry point loaded by Uvicorn.
"""
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend.app.database import initialize_database
from backend.app.routes.classify import router as classify_router
from backend.app.routes.class_examples import router as class_examples_router
from backend.app.routes.exports import router as export_router
from backend.app.routes.game import router as game_router
from backend.app.routes.research import router as research_router
from backend.app.routes.reports import router as report_router


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
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register /classify router
app.include_router(classify_router)
app.include_router(research_router)
app.include_router(game_router)
app.include_router(class_examples_router)
app.include_router(export_router)
app.include_router(report_router)


FRONTEND_DIST_ENVIRONMENT_VARIABLE = "AI_IMAGE_GAME_FRONTEND_DIST"
API_PATH_ROOTS = {
    "classify",
    "docs",
    "game",
    "health",
    "openapi.json",
    "redoc",
    "research",
}


def configured_frontend_dist() -> Path | None:
    """Return a verified production frontend directory when one is configured."""
    configured = os.getenv(FRONTEND_DIST_ENVIRONMENT_VARIABLE)
    if not configured:
        return None
    directory = Path(configured).expanduser().resolve()
    if not (directory / "index.html").is_file():
        raise RuntimeError(f"Frontend build is missing index.html: {directory}")
    return directory


frontend_dist = configured_frontend_dist()
if frontend_dist is not None and (frontend_dist / "assets").is_dir():
    app.mount(
        "/assets",
        StaticFiles(directory=frontend_dist / "assets"),
        name="frontend-assets",
    )


@app.get("/", response_model=None)
def read_root() -> dict[str, str] | FileResponse:
    if frontend_dist is not None:
        return FileResponse(frontend_dist / "index.html")
    return {"message": "AI Image Classifier Game API"}


@app.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}


if frontend_dist is not None:

    @app.get("/{frontend_path:path}", include_in_schema=False)
    def read_frontend(frontend_path: str) -> FileResponse:
        """Serve public files or the SPA entry point after API routes are checked."""
        if frontend_path.partition("/")[0] in API_PATH_ROOTS:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
        requested = (frontend_dist / frontend_path).resolve()
        if requested.is_relative_to(frontend_dist) and requested.is_file():
            return FileResponse(requested)
        return FileResponse(frontend_dist / "index.html")
