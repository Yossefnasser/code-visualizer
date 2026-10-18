from app.models.user import User


def list_users():
    return User.query.all()


def get_user(user_id):
    return User.query.get(user_id)
