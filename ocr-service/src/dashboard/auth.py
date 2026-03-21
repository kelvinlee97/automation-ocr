import secrets
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from ..config.loader import get_config

security = HTTPBasic()

def verify_admin_credentials(credentials: HTTPBasicCredentials = Depends(security)) -> str:
    config = get_config()
    dashboard_config = config.get("dashboard", {})
    correct_username = dashboard_config.get("admin_username", "admin").encode("utf8")
    correct_password = dashboard_config.get("admin_password", "password123").encode("utf8")

    is_correct_username = secrets.compare_digest(
        credentials.username.encode("utf8"), correct_username
    )
    is_correct_password = secrets.compare_digest(
        credentials.password.encode("utf8"), correct_password
    )

    if not (is_correct_username and is_correct_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Basic"},
        )
    return credentials.username

