import json
import logging
import os
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

import discord
from discord import app_commands
from discord.ext import commands
from dotenv import load_dotenv

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

TOTAL_GIFTCARDS = 2
ANNOUNCEMENT_CHANNEL_ID = 1372572234949853367
STATE_FILE = Path("data/state.json")
COOLDOWN_FILE = Path("data/cooldowns.json")


def load_state() -> dict:
    if not STATE_FILE.exists():
        return {"giftcards_remaining": TOTAL_GIFTCARDS, "user_chances": {}}

    try:
        with STATE_FILE.open("r", encoding="utf-8") as f:
            state = json.load(f)
            state.setdefault("giftcards_remaining", TOTAL_GIFTCARDS)
            state.setdefault("user_chances", {})
            return state
    except json.JSONDecodeError:
        logger.warning("State file was corrupted; resetting state.")
        return {"giftcards_remaining": TOTAL_GIFTCARDS, "user_chances": {}}


def save_state(state: dict) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    with STATE_FILE.open("w", encoding="utf-8") as f:
        json.dump(state, f)


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


async def enforce_persistent_cooldown(interaction: discord.Interaction) -> bool:
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


class RollBot(commands.Bot):
    def __init__(self) -> None:
        intents = discord.Intents.default()
        super().__init__(command_prefix="!", intents=intents)

    async def setup_hook(self) -> None:
        await self.tree.sync()


bot = RollBot()


@app_commands.check(enforce_persistent_cooldown)
@bot.tree.command(name="roll", description="Try your luck for a 10$ giftcard!")
async def roll(interaction: discord.Interaction) -> None:
    state = load_state()
    cooldowns = load_cooldowns()
    giftcards_remaining = state.get("giftcards_remaining", TOTAL_GIFTCARDS)
    user_chances: dict[str, int] = state.get("user_chances", {})
    user_key = str(interaction.user.id)
    success_chance = max(0, min(100, user_chances.get(user_key, 1)))
    fail_chance = 100 - success_chance

    if giftcards_remaining <= 0:
        await interaction.response.send_message(
            "All giftcards have been claimed. The event has ended.", ephemeral=True
        )
        return

    roll_value = random.random()
    logger.info(
        "User %s rolled %.4f with success chance %d%%",
        interaction.user.id,
        roll_value,
        success_chance,
    )

    if roll_value <= success_chance / 100:
        giftcards_remaining -= 1
        state["giftcards_remaining"] = giftcards_remaining

        next_success_chance = 1
        next_fail_chance = 99
        user_chances[user_key] = next_success_chance
        state["user_chances"] = user_chances
        save_state(state)

        cooldowns[user_key] = (
            datetime.now(timezone.utc) + timedelta(hours=24)
        ).isoformat()
        save_cooldowns(cooldowns)

        await interaction.response.send_message(
            (
                f"Congratulation, {interaction.user.mention} you have won 10$ Giftcard!"
                " Your success chance has been reset for the next roll."
                f"\n-# Your current Success chance - {next_success_chance}% ; "
                f"Fail chance - {next_fail_chance}%"
            )
        )
        await announce_giftcard_status(interaction.client, giftcards_remaining)
    else:
        success_chance = min(100, success_chance + 1)
        fail_chance = 100 - success_chance
        user_chances[user_key] = success_chance
        state["user_chances"] = user_chances
        save_state(state)

        cooldowns[user_key] = (
            datetime.now(timezone.utc) + timedelta(hours=24)
        ).isoformat()
        save_cooldowns(cooldowns)

        await interaction.response.send_message(
            (
                "No prize this time—your success chance increased by 1% for the next roll."
                f"\n-# Your current Success chance - {success_chance}% ; "
                f"Fail chance - {fail_chance}%"
            )
        )


@bot.tree.error
async def on_app_command_error(interaction: discord.Interaction, error: Exception) -> None:
    if isinstance(error, app_commands.CommandOnCooldown):
        retry_after_hours = int(error.retry_after // 3600)
        retry_after_minutes = int((error.retry_after % 3600) // 60)

        cooldowns = load_cooldowns()
        cooldowns[str(interaction.user.id)] = (
            datetime.now(timezone.utc) + timedelta(seconds=error.retry_after)
        ).isoformat()
        save_cooldowns(cooldowns)

        await interaction.response.send_message(
            f"You can use this command again in {retry_after_hours}h {retry_after_minutes}m.",
            ephemeral=True,
        )
    else:
        logger.exception("An error occurred while handling command: %s", error)
        await interaction.response.send_message(
            "An unexpected error occurred. Please try again later.", ephemeral=True
        )


async def announce_giftcard_status(client: discord.Client, giftcards_remaining: int) -> None:
    channel = client.get_channel(ANNOUNCEMENT_CHANNEL_ID)
    if channel is None:
        try:
            channel = await client.fetch_channel(ANNOUNCEMENT_CHANNEL_ID)
        except discord.DiscordException as error:
            logger.error("Unable to fetch announcement channel: %s", error)
            return

    if giftcards_remaining == 1:
        message = (
            "@here there's only 1 Giftcard left, goodluck users! "
            "Try your luck by using command `/roll`"
        )
    else:
        message = (
            "@here, looks like all Giftcards are received. "
            "The event ends here, thanks for playing!"
        )

    await channel.send(message)


def main() -> None:
    load_dotenv()
    cleanup_expired_cooldowns()
    token = os.getenv("DISCORD_TOKEN")
    if not token:
        raise RuntimeError("DISCORD_TOKEN environment variable is not set.")
    bot.run(token)


if __name__ == "__main__":
    main()
