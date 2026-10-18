from fastapi import APIRouter

router = APIRouter()

blueprint = object()


@blueprint.get("/nope")
def nope_handler():
    return None
