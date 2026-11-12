"""Dormant subscription management. Intentionally not mounted in main.py.

Payment processing does not exist here. Enabling routes requires a separate change
after plan definitions and entitlements are agreed with the product owner.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from db import connect
import uuid

ENABLED = False
router = APIRouter(prefix='/api/subscriptions')


def require_enabled():
    if not ENABLED:
        raise HTTPException(404, 'Not found')


class SubscriptionUpdate(BaseModel):
    plan_id: str = Field(pattern=r'^[a-z0-9_-]{1,40}$')
    status: str = Field(pattern=r'^(free|trialing|active|past_due|canceled)$')
    cancel_at_period_end: bool = False


def root_user(request):
    # Import lazily to avoid circular initialization when this router is enabled.
    from main import user
    current = user(request)
    if not current.get('is_root'):
        raise HTTPException(403, 'Administrator access required.')
    return current


def get_subscription(user_id):
    require_enabled()
    with connect() as db:
        return db.execute('SELECT user_id,plan_id,status,current_period_end,cancel_at_period_end FROM subscriptions WHERE user_id=%s', (user_id,)).fetchone()


def update_subscription(user_id, data: SubscriptionUpdate):
    require_enabled()
    with connect() as db:
        if not db.execute('SELECT id FROM subscription_plans WHERE id=%s', (data.plan_id,)).fetchone():
            raise HTTPException(422, 'Unknown plan.')
        return db.execute(
            'INSERT INTO subscriptions(user_id,plan_id,status,cancel_at_period_end) VALUES (%s,%s,%s,%s) '
            'ON CONFLICT(user_id) DO UPDATE SET plan_id=excluded.plan_id,status=excluded.status,cancel_at_period_end=excluded.cancel_at_period_end,updated_at=now() '
            'RETURNING user_id,plan_id,status,current_period_end,cancel_at_period_end',
            (user_id,data.plan_id,data.status,data.cancel_at_period_end),
        ).fetchone()

# No checkout route or payment provider is registered. A future route must apply
# root_user for administrative changes and main.user for an account's own details.
