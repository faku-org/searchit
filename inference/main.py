import uvicorn

from app import app
from config import get_settings

if __name__ == "__main__":
    # Importing the ASGI app object directly (rather than uvicorn's
    # "module:attr" string form) avoids a dynamic import that doesn't
    # resolve inside a frozen PyInstaller bundle.
    settings = get_settings()
    uvicorn.run(app, host="127.0.0.1", port=settings.port)
