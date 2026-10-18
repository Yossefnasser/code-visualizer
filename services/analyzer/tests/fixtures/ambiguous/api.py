from fastapi import APIRouter

from external_lib import mystery_function
from app.services import missing_service

router = APIRouter()


@router.get("/a")
def a_handler():
    return mystery_function()


@router.get("/missing")
def missing_handler():
    return missing_service.do_work()


@router.get("/b")
def b_handler():
    return undefined_local_thing()
