import json
import logging
import os
import random
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


def load_state() -> dict:
    if not STATE_FILE.exists():
        return {"giftcards_remaining": TOTAL_GIFTCARDS}

    try:
        with STATE_FILE.open("r", encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError:
        logger.warning("State file was corrupted; resetting state.")
        return {"giftcards_remaining": TOTAL_GIFTCARDS}


def save_state(state: dict) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    with STATE_FILE.open("w", encoding="utf-8") as f:
        json.dump(state, f)


class RollBot(commands.Bot):
    def __init__(self) -> None:
        intents = discord.Intents.default()
        super().__init__(command_prefix="!", intents=intents)

    async def setup_hook(self) -> None:
        await self.tree.sync()


bot = RollBot()


@bot.tree.command(name="roll", description="Try your luck for a 10$ giftcard!")
@app_commands.checks.cooldown(1, 24 * 60 * 60, key=lambda interaction: interaction.user.id)
async def roll(interaction: discord.Interaction) -> None:
    state = load_state()
    giftcards_remaining = state.get("giftcards_remaining", TOTAL_GIFTCARDS)

    if giftcards_remaining <= 0:
        await interaction.response.send_message(
            "All giftcards have been claimed. The event has ended.", ephemeral=True
        )
        return

    roll_value = random.random()
    logger.info("User %s rolled %.4f", interaction.user.id, roll_value)

    if roll_value <= 0.01:
        giftcards_remaining -= 1
        state["giftcards_remaining"] = giftcards_remaining
        save_state(state)

        await interaction.response.send_message(
            f"Congratulation, {interaction.user.mention} you have won 10$ Giftcard!"
        )
        await announce_giftcard_status(interaction.client, giftcards_remaining)
    else:
        await interaction.response.send_message(
            "Better luck next time, your luck increased by 1%"
        )


@bot.tree.error
async def on_app_command_error(interaction: discord.Interaction, error: Exception) -> None:
    if isinstance(error, app_commands.CommandOnCooldown):
        retry_after_hours = int(error.retry_after // 3600)
        retry_after_minutes = int((error.retry_after % 3600) // 60)
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
    token = os.getenv("DISCORD_TOKEN")
    if not token:
        raise RuntimeError("DISCORD_TOKEN environment variable is not set.")
    bot.run(token)


if __name__ == "__main__":
    main()
