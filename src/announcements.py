import logging

import discord

ANNOUNCEMENT_CHANNEL_ID = 1372572234949853367

logger = logging.getLogger(__name__)


def _format_message(giftcards_remaining: int) -> str:
    if giftcards_remaining == 1:
        return (
            "@here there's only 1 Giftcard left, goodluck users! "
            "Try your luck by using command `/roll`"
        )

    return (
        "@here, looks like all Giftcards are received. "
        "The event ends here, thanks for playing!"
    )


async def announce_giftcard_status(client: discord.Client, giftcards_remaining: int) -> None:
    channel = client.get_channel(ANNOUNCEMENT_CHANNEL_ID)
    if channel is None:
        try:
            channel = await client.fetch_channel(ANNOUNCEMENT_CHANNEL_ID)
        except discord.DiscordException as error:
            logger.error("Unable to fetch announcement channel: %s", error)
            return

    await channel.send(_format_message(giftcards_remaining))
