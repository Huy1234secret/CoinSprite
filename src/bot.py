import importlib
import logging
import os
from pathlib import Path

import discord
from discord.ext import commands
from dotenv import load_dotenv

from state import cleanup_expired_cooldowns

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

COMMANDS_DIR = Path(__file__).parent / "commands"


class RollBot(commands.Bot):
    def __init__(self) -> None:
        intents = discord.Intents.default()
        super().__init__(command_prefix="!", intents=intents)

    async def setup_hook(self) -> None:
        await self._load_commands()
        await self.tree.sync()

    async def _load_commands(self) -> None:
        for path in sorted(COMMANDS_DIR.glob("*.py")):
            if path.name.startswith("__"):
                continue

            module_name = f"commands.{path.stem}"
            module = importlib.import_module(module_name)

            register = getattr(module, "register", None)
            if callable(register):
                register(self)
                logger.info("Loaded command module: %s", module_name)
            else:
                logger.warning("Module %s does not define a register function", module_name)


def main() -> None:
    load_dotenv()
    cleanup_expired_cooldowns()
    token = os.getenv("DISCORD_TOKEN")
    if not token:
        raise RuntimeError("DISCORD_TOKEN environment variable is not set.")

    bot = RollBot()
    bot.run(token)


if __name__ == "__main__":
    main()
