import { state } from './state.js';
import { avatarUrl } from './session.js';

// Only identities available from the current authenticated session are resolved.
// Event-specific values stay as tokens until the bot renders the real event.
export function previewIdentity() {
  const user = state.me?.user;
  const guild = state.guilds.find(item => item.id === state.guildId);
  const name = user?.globalName || user?.username;
  return {
    user: name ? `@${name}` : '{user}',
    username: user?.username || '{username}',
    display_name: name || '{display_name}',
    user_id: user?.id || '{user_id}',
    user_avatar: user ? avatarUrl(user) : '',
    user_profile: user ? avatarUrl(user) : '',
    server: guild?.name || '{server}',
    server_icon: guild?.iconURL || '',
  };
}
