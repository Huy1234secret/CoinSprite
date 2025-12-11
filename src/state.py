import json
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path

import discord
from discord import app_commands

logger = logging.getLogger(__name__)

COOLDOWN_FILE = Path("data/cooldowns.json")


def load_cooldowns() -> dict:
    if not COOLDOWN_FILE.exists():
        return {}

    try:
        with COOLDOWN_FILE.open("r", encoding="utf-8") as f:
            cooldowns = json.load(f)
            if not isinstance(cooldowns, dict):
                logger.warning("Cooldowns file content invalid; resetting cooldowns.")
                return {}
            return cooldowns
    except json.JSONDecodeError:
        logger.warning("Cooldown file was corrupted; resetting cooldowns.")
        return {}


def save_cooldowns(cooldowns: dict) -> None:
    COOLDOWN_FILE.parent.mkdir(parents=True, exist_ok=True)
    with COOLDOWN_FILE.open("w", encoding="utf-8") as f:
        json.dump(cooldowns, f)


def cleanup_expired_cooldowns() -> None:
    """Remove cooldown entries that have already expired."""

    cooldowns = load_cooldowns()
    now = datetime.now(timezone.utc)
    updated_cooldowns = {}

    for user_id, expiry_str in cooldowns.items():
        try:
            expiry = datetime.fromisoformat(expiry_str)
        except ValueError:
            logger.warning("Invalid cooldown timestamp for user %s; removing entry.", user_id)
            continue

        if expiry > now:
            updated_cooldowns[user_id] = expiry_str

    if len(updated_cooldowns) != len(cooldowns):
        save_cooldowns(updated_cooldowns)
        logger.info("Removed %d expired cooldown entries.", len(cooldowns) - len(updated_cooldowns))


def enforce_persistent_cooldown(interaction: discord.Interaction) -> bool:
    """Ensure users remain on cooldown across bot restarts."""

    cooldowns = load_cooldowns()
    user_key = str(interaction.user.id)
    expiry_str = cooldowns.get(user_key)

    if expiry_str is None:
        return True

    try:
        expiry = datetime.fromisoformat(expiry_str)
    except ValueError:
        logger.warning("Invalid cooldown timestamp for user %s; removing entry.", user_key)
        cooldowns.pop(user_key, None)
        save_cooldowns(cooldowns)
        return True

    now = datetime.now(timezone.utc)
    if expiry > now:
        retry_after = (expiry - now).total_seconds()
        raise app_commands.CommandOnCooldown(app_commands.Cooldown(1, 24 * 60 * 60), retry_after)

    cooldowns.pop(user_key, None)
    save_cooldowns(cooldowns)
    return True


def update_cooldown(interaction: discord.Interaction, hours: int) -> None:
    cooldowns = load_cooldowns()
    cooldowns[str(interaction.user.id)] = (
        datetime.now(timezone.utc) + timedelta(hours=hours)
    ).isoformat()
    save_cooldowns(cooldowns)


def set_retry_cooldown(interaction: discord.Interaction, retry_after_seconds: float) -> None:
    cooldowns = load_cooldowns()
    cooldowns[str(interaction.user.id)] = (
        datetime.now(timezone.utc) + timedelta(seconds=retry_after_seconds)
    ).isoformat()
    save_cooldowns(cooldowns)
