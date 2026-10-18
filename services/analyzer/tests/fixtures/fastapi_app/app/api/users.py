from fastapi import APIRouter

from app.services.user_service import get_user, list_users

router = APIRouter()


@router.get("/users")
def list_users_endpoint():
    return list_users()


@router.get("/users/{user_id}")
def get_user_endpoint(user_id: int):
    return get_user(user_id)
