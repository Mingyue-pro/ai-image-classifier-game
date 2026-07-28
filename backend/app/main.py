"""
FastAPI application entry point loaded by Uvicorn.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.app.routes.classify import router as classify_router

# Create FastAPI app
app = FastAPI(
    title="AI Image Classifier Game API",
    version="0.1.0",
)

# Configure frontend cross-origin access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register /classify router
app.include_router(classify_router)


@app.get("/")
def read_root() -> dict[str, str]:
    return {"message": "AI Image Classifier Game API"}


@app.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}
