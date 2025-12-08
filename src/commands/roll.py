import logging
import random

import discord
from discord import app_commands
from discord.ext import commands

from announcements import announce_giftcard_status
from state import (
    TOTAL_GIFTCARDS,
    cleanup_expired_cooldowns,
    enforce_persistent_cooldown,
    load_state,
    save_state,
    set_retry_cooldown,
    update_cooldown,
)

logger = logging.getLogger(__name__)


def register(bot: commands.Bot) -> None:
    @app_commands.check(enforce_persistent_cooldown)
    @bot.tree.command(name="roll", description="Try your luck for a 10$ giftcard!")
    async def roll(interaction: discord.Interaction) -> None:
        state = load_state()
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

            update_cooldown(interaction, hours=24)

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

            update_cooldown(interaction, hours=24)

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

            set_retry_cooldown(interaction, error.retry_after)

            await interaction.response.send_message(
                f"You can use this command again in {retry_after_hours}h {retry_after_minutes}m.",
                ephemeral=True,
            )
        else:
            logger.exception("An error occurred while handling command: %s", error)
            await interaction.response.send_message(
                "An unexpected error occurred. Please try again later.", ephemeral=True
            )

    cleanup_expired_cooldowns()
