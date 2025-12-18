import copy
import json
import logging
from pathlib import Path
from typing import Any, List, Optional

import discord
from discord import app_commands
from discord.ext import commands

logger = logging.getLogger(__name__)

HUNT_DATA_FILE = Path("data/hunt_profiles.json")
HUNT_THUMBNAIL_URL = (
    "https://cdn.discordapp.com/emojis/1447497801033453589.png?size=128&quality=lossless"
)
HEALTH_EMOJI = "<:SBHeart:1447532986378485882>"
DEFENSE_EMOJI = "<:SBDefense:1447532983933472900>"
DEFAULT_PROFILE: dict[str, Any] = {
    "level": 1,
    "xp": 0,
    "next_level_xp": 100,
    "health": 100,
    "defense": 0,
    "gear_equipped": None,
    "misc_equipped": None,
    "gear_inventory": [],
    "misc_inventory": [],
}


def load_hunt_profiles() -> dict[str, dict[str, Any]]:
    if not HUNT_DATA_FILE.exists():
        return {}

    try:
        with HUNT_DATA_FILE.open("r", encoding="utf-8") as f:
            data = json.load(f)
            if not isinstance(data, dict):
                logger.warning("Invalid hunt profiles file content; resetting file.")
                return {}
            return data
    except json.JSONDecodeError:
        logger.warning("Hunt profiles file corrupted; resetting file.")
        return {}


def save_hunt_profiles(data: dict[str, dict[str, Any]]) -> None:
    HUNT_DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    with HUNT_DATA_FILE.open("w", encoding="utf-8") as f:
        json.dump(data, f)


def get_user_profile(user_id: int) -> dict[str, Any]:
    data = load_hunt_profiles()
    user_key = str(user_id)
    profile = data.get(user_key)
    if profile is None:
        profile = copy.deepcopy(DEFAULT_PROFILE)
        data[user_key] = profile
        save_hunt_profiles(data)
    else:
        # ensure required keys exist for older records
        for key, value in DEFAULT_PROFILE.items():
            profile.setdefault(key, value)
        data[user_key] = profile
        save_hunt_profiles(data)

    return profile


def update_user_profile(user_id: int, profile: dict[str, Any]) -> None:
    data = load_hunt_profiles()
    data[str(user_id)] = profile
    save_hunt_profiles(data)


def build_progress_bar(current: int, total: int, width: int = 20) -> str:
    total = max(total, 1)
    ratio = max(0, min(1, current / total))
    filled = int(ratio * width)
    empty = width - filled
    return "█" * filled + "░" * empty


def format_home_embed(profile: dict[str, Any]) -> discord.Embed:
    has_tool = bool(profile.get("gear_inventory") or profile.get("misc_inventory"))
    message = (
        "You don't have any HUNTING tool..."
        if not has_tool
        else "Press **HUNT** button to start hunting."
    )

    embed = discord.Embed(
        description=f"## Hunting\n-# {message}",
        color=discord.Color.light_grey(),
    )
    embed.set_thumbnail(url=HUNT_THUMBNAIL_URL)
    return embed


def format_stats_embed(profile: dict[str, Any]) -> discord.Embed:
    level = profile.get("level", DEFAULT_PROFILE["level"])
    xp = profile.get("xp", DEFAULT_PROFILE["xp"])
    next_level = profile.get("next_level_xp", DEFAULT_PROFILE["next_level_xp"])
    health = profile.get("health", DEFAULT_PROFILE["health"])
    defense = profile.get("defense", DEFAULT_PROFILE["defense"])

    progress_bar = build_progress_bar(xp, next_level)
    percent = min(100, max(0, (xp / next_level) * 100 if next_level else 0))

    embed = discord.Embed(color=discord.Color.light_grey())
    embed.description = (
        "## Hunting Stat\n"
        f"### Hunt Level: {level}\n"
        f"-# {progress_bar} `{xp} / {next_level} - {percent:.2f}%`\n"
        f"* User Health: {health} {HEALTH_EMOJI}\n"
        f"* User Defense: {defense} {DEFENSE_EMOJI}"
    )
    embed.set_thumbnail(url=HUNT_THUMBNAIL_URL)
    return embed


def format_equipment_embeds(profile: dict[str, Any]) -> List[discord.Embed]:
    gear = profile.get("gear_equipped") or {}
    misc = profile.get("misc_equipped") or {}

    gear_name = gear.get("name", "None")
    gear_emoji = gear.get("emoji", "")
    misc_name = misc.get("name", "None")
    misc_emoji = misc.get("emoji", "")

    template_embed = discord.Embed(color=discord.Color.dark_grey())
    template_embed.description = (
        "## Hunt Equipment Template\n"
        "-# Fill your loadout using the selectors below.\n"
        f"* Gear Slot: `{gear_name}` {gear_emoji}\n"
        f"* Misc Slot: `{misc_name}` {misc_emoji}"
    )
    template_embed.set_thumbnail(url=HUNT_THUMBNAIL_URL)

    info_embed = discord.Embed(color=discord.Color.light_grey())
    info_embed.description = (
        "## Hunting Equipment\n"
        f"### * Gear equipped: {gear_name} {gear_emoji}\n"
        f"### * Misc equipped: {misc_name} {misc_emoji}"
    )
    info_embed.set_thumbnail(url=HUNT_THUMBNAIL_URL)

    selection_embed = discord.Embed(color=discord.Color.dark_grey())
    selection_embed.description = (
        "Use the selectors below to choose your Hunting Gear and Misc equipment."
    )
    return [template_embed, info_embed, selection_embed]


def gear_placeholder(profile: dict[str, Any]) -> str:
    inventory = profile.get("gear_inventory", [])
    if not inventory:
        return "You don't have any Gear"
    if not profile.get("gear_equipped"):
        return "No Gear equipped"
    equipped = profile["gear_equipped"]
    return f"{equipped.get('name', 'Gear')} {equipped.get('emoji', '')}".strip()


def misc_placeholder(profile: dict[str, Any]) -> str:
    inventory = profile.get("misc_inventory", [])
    if not inventory:
        return "You don't have any Misc"
    if not profile.get("misc_equipped"):
        return "No Misc equipped"
    equipped = profile["misc_equipped"]
    return f"{equipped.get('name', 'Misc')} {equipped.get('emoji', '')}".strip()


def build_gear_options(
    profile: dict[str, Any], equipped_name: Optional[str] = None
) -> List[discord.SelectOption]:
    equipped_name = equipped_name or (profile.get("gear_equipped") or {}).get("name")
    options = []
    for item in profile.get("gear_inventory", []):
        if not isinstance(item, dict):
            continue
        item_name = item.get("name", "Gear")
        options.append(
            discord.SelectOption(
                label=item_name,
                value=item_name,
                emoji=item.get("emoji"),
                default=equipped_name == item_name,
            )
        )
    if options and not any(option.default for option in options):
        options[0].default = True
    return options


def build_misc_options(profile: dict[str, Any]) -> List[discord.SelectOption]:
    options = []
    for item in profile.get("misc_inventory", []):
        if not isinstance(item, dict):
            continue
        options.append(
            discord.SelectOption(
                label=item.get("name", "Misc"),
                value=item.get("name", "Misc"),
                emoji=item.get("emoji"),
            )
        )
    return options


class BaseHuntView(discord.ui.View):
    def __init__(
        self,
        user: discord.abc.User,
        *,
        timeout: Optional[float] = 300,
        add_separator: bool = True,
    ):
        super().__init__(timeout=timeout)
        self.user = user

        if add_separator:
            separator = discord.ui.Button(
                label=" ", style=discord.ButtonStyle.secondary, disabled=True, row=0
            )
            self.add_item(separator)

    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        if interaction.user.id != self.user.id:
            await interaction.response.send_message(
                "Only the user who opened this menu can interact with it.",
                ephemeral=True,
            )
            return False
        return True


class HuntHomeView(BaseHuntView):
    def __init__(self, user: discord.abc.User):
        super().__init__(user)

    @discord.ui.button(
        label="HUNT", style=discord.ButtonStyle.danger, disabled=True, row=1
    )
    async def hunt_button(
        self, interaction: discord.Interaction, button: discord.ui.Button
    ) -> None:
        await interaction.response.send_message(
            "Hunting is currently WIP. Stay tuned!"
        )

    @discord.ui.button(label="Hunt Stat", style=discord.ButtonStyle.secondary, row=1)
    async def hunt_stat_button(
        self, interaction: discord.Interaction, button: discord.ui.Button
    ) -> None:
        profile = get_user_profile(interaction.user.id)
        await interaction.response.edit_message(
            embeds=[format_stats_embed(profile)], view=HuntStatsView(interaction.user)
        )

    @discord.ui.button(label="Equipment", style=discord.ButtonStyle.secondary, row=1)
    async def equipment_button(
        self, interaction: discord.Interaction, button: discord.ui.Button
    ) -> None:
        profile = get_user_profile(interaction.user.id)
        await interaction.response.edit_message(
            embeds=format_equipment_embeds(profile),
            view=HuntEquipmentView(interaction.user),
        )


class HuntStatsView(BaseHuntView):
    def __init__(self, user: discord.abc.User):
        super().__init__(user)

    @discord.ui.button(label="Back", style=discord.ButtonStyle.secondary, row=1)
    async def back_button(
        self, interaction: discord.Interaction, button: discord.ui.Button
    ) -> None:
        profile = get_user_profile(interaction.user.id)
        await interaction.response.edit_message(
            embeds=[format_home_embed(profile)], view=HuntHomeView(interaction.user)
        )

    @discord.ui.button(
        label="Hunt Stat", style=discord.ButtonStyle.danger, disabled=True, row=1
    )
    async def hunt_stat_button(
        self, interaction: discord.Interaction, button: discord.ui.Button
    ) -> None:
        # Button remains disabled as the user is already on this view
        await interaction.response.defer()

    @discord.ui.button(label="Equipment", style=discord.ButtonStyle.secondary, row=1)
    async def equipment_button(
        self, interaction: discord.Interaction, button: discord.ui.Button
    ) -> None:
        profile = get_user_profile(interaction.user.id)
        await interaction.response.edit_message(
            embeds=format_equipment_embeds(profile),
            view=HuntEquipmentView(interaction.user),
        )


class GearSelect(discord.ui.Select):
    def __init__(self, user: discord.abc.User, profile: dict[str, Any]):
        equipped_name = (profile.get("gear_equipped") or {}).get("name")
        options = build_gear_options(profile, equipped_name)
        placeholder = gear_placeholder(profile)
        super().__init__(
            placeholder=placeholder,
            options=options if options else [discord.SelectOption(label=" ")],
            disabled=not options,
            min_values=1,
            max_values=1,
        )
        self.user = user

    async def callback(self, interaction: discord.Interaction) -> None:
        profile = get_user_profile(interaction.user.id)
        selected_name = self.values[0]
        selected_item = next(
            (
                item
                for item in profile.get("gear_inventory", [])
                if isinstance(item, dict) and item.get("name") == selected_name
            ),
            None,
        )
        if selected_item:
            profile["gear_equipped"] = selected_item
            update_user_profile(interaction.user.id, profile)

        await interaction.response.edit_message(
            embeds=format_equipment_embeds(profile),
            view=HuntEquipmentView(interaction.user),
        )


class MiscSelect(discord.ui.Select):
    def __init__(self, user: discord.abc.User, profile: dict[str, Any]):
        options = build_misc_options(profile)
        placeholder = misc_placeholder(profile)
        super().__init__(
            placeholder=placeholder,
            options=options if options else [discord.SelectOption(label=" ")],
            disabled=not options,
            min_values=1,
            max_values=1,
        )
        self.user = user

    async def callback(self, interaction: discord.Interaction) -> None:
        profile = get_user_profile(interaction.user.id)
        selected_name = self.values[0]
        selected_item = next(
            (
                item
                for item in profile.get("misc_inventory", [])
                if isinstance(item, dict) and item.get("name") == selected_name
            ),
            None,
        )
        if selected_item:
            profile["misc_equipped"] = selected_item
            update_user_profile(interaction.user.id, profile)

        await interaction.response.edit_message(
            embeds=format_equipment_embeds(profile),
            view=HuntEquipmentView(interaction.user),
        )


class HuntEquipmentView(BaseHuntView):
    def __init__(self, user: discord.abc.User):
        super().__init__(user, add_separator=False)
        profile = get_user_profile(user.id)
        gear_select = GearSelect(user, profile)
        gear_select.row = 0
        misc_select = MiscSelect(user, profile)
        misc_select.row = 1
        self.add_item(gear_select)
        self.add_item(misc_select)

        separator = discord.ui.Button(
            label=" ", style=discord.ButtonStyle.secondary, disabled=True, row=2
        )
        self.add_item(separator)

    @discord.ui.button(label="Back", style=discord.ButtonStyle.secondary, row=3)
    async def back_button(
        self, interaction: discord.Interaction, button: discord.ui.Button
    ) -> None:
        profile = get_user_profile(interaction.user.id)
        await interaction.response.edit_message(
            embeds=[format_home_embed(profile)], view=HuntHomeView(interaction.user)
        )

    @discord.ui.button(label="Hunt Stat", style=discord.ButtonStyle.secondary, row=3)
    async def hunt_stat_button(
        self, interaction: discord.Interaction, button: discord.ui.Button
    ) -> None:
        profile = get_user_profile(interaction.user.id)
        await interaction.response.edit_message(
            embeds=[format_stats_embed(profile)], view=HuntStatsView(interaction.user)
        )

    @discord.ui.button(
        label="Equipment", style=discord.ButtonStyle.danger, disabled=True, row=3
    )
    async def equipment_button(
        self, interaction: discord.Interaction, button: discord.ui.Button
    ) -> None:
        await interaction.response.defer()


def register(bot: commands.Bot) -> None:
    @bot.tree.command(name="hunt", description="Open the hunting menu")
    @app_commands.checks.cooldown(1, 3)
    async def hunt(interaction: discord.Interaction) -> None:
        profile = get_user_profile(interaction.user.id)
        await interaction.response.send_message(
            embeds=[format_home_embed(profile)], view=HuntHomeView(interaction.user)
        )

    @hunt.error
    async def on_hunt_error(
        interaction: discord.Interaction, error: app_commands.AppCommandError
    ) -> None:
        if isinstance(error, app_commands.CommandOnCooldown):
            retry_after = error.retry_after
            await interaction.response.send_message(
                f"Please wait {retry_after:.1f}s before using /hunt again.",
                ephemeral=True,
            )
            return

        logger.exception("An error occurred while handling /hunt: %s", error)
        await interaction.response.send_message(
            "An unexpected error occurred while opening the hunting menu.",
            ephemeral=True,
        )
