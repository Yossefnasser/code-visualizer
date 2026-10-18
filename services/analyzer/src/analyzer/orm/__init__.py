"""ORM adapters for the analyzer.

Each adapter discovers models for one ORM framework. Adapters must not import
or execute the analyzed project; they operate purely on parsed AST symbols.
"""

from .base import FieldInfo, ModelIndex, ModelInfo, ORMAdapter
from .django_adapter import DjangoAdapter
from .sqlalchemy_adapter import SQLAlchemyAdapter

__all__ = [
    "DjangoAdapter",
    "FieldInfo",
    "ModelInfo",
    "ModelIndex",
    "ORMAdapter",
    "SQLAlchemyAdapter",
]
