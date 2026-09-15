const { el, action, control, toggle, section, pageTitle, composer } = require('../layoutKit');

function shortPreview(title, id, emojiId) {
  return el('section', { class: 'message-composer short-preview' },
    el('header', { class: 'composer-toolbar' }, el('strong', {}, title), action(emojiId, '😀 Emoji', 'tool')),
    el('div', { class: 'discord-preview' }, el('div', { class: 'discord-frame', id })));
}

function leveling() {
  return el('section', { class: 'view active', id: 'levelingView', 'data-view-panel': 'leveling' },
    pageTitle('LEVELING', 'Give activity a direction.', 'Set the rhythm of XP and decide how progress gets celebrated.',
      toggle('Leveling on', 'levelingEnabled', 'Award XP to eligible messages')),
    section('Activity rhythm', 'Control each XP award without encouraging repeat messages.',
      el('div', { class: 'field-grid three' },
        control('Minimum XP', 'levelingXpMin', 'number', 'Lowest award per message', { min: '1', max: '1000' }),
        control('Maximum XP', 'levelingXpMax', 'number', 'Highest award per message', { min: '1', max: '2000' }),
        control('Cooldown', 'levelingCooldown', 'number', 'Seconds between awards', { min: '0', max: '3600' }),
        control('Level-one XP', 'levelingBaseXp', 'number', 'Starting requirement', { min: '25', max: '100000' }),
        control('Growth', 'levelingGrowth', 'number', 'Difficulty of later levels', { min: '1', max: '3', step: '0.05' }),
        control('Level cap', 'levelingMaxLevel', 'number', 'Maximum reachable level', { min: '1', max: '1000' })),
      el('div', { id: 'levelingCurvePreview', class: 'curve-preview' })),
    section('Level-up message', 'Choose a channel and shape the Discord message that members see.',
      el('div', { class: 'field-grid two' },
        toggle('Send announcements', 'levelingAnnounceEnabled', 'Post a level-up card'),
        control('Announcement channel', 'levelingAnnounceChannel', 'select', 'Leave blank to use the active channel')),
      composer('Leveling', {
        panel: 'levelingComposerPanel', frame: 'levelingDiscordFrame', accentButton: 'levelingAccentButton',
        accentColor: 'levelingAccentColor', preview: 'levelingMessagePreview', additional: 'levelingAdditionalContainers',
      }, {
        title: 'Level-up preview', note: 'Click the message to make a change.',
        actions: [action('levelingUseTemplate', 'Use template'), action('levelingSaveAsTemplate', 'Save as template')],
        tools: [
          ['levelingEmojiToggle', '😀 Emoji'], ['levelingVariablesToggle', '{ } Variables'],
          ['levelingContainerAdd', '▣ Container'], ['levelingAdditionalContainerAdd', '＋ Container'],
          ['levelingThumbnailAdd', '▧ Thumbnail'], ['levelingGalleryAdd', '▦ Gallery'],
        ],
      })),
    section('Scheduled XP drops', 'Offer crates on a timer or send a zero-XP test before going live.',
      el('div', { class: 'field-grid two' },
        toggle('Scheduled drops', 'xpDropsEnabled', 'Run enabled crates on their timers'),
        control('Default drop channel', 'xpDropChannel', 'select', 'Individual crates may use a fallback')),
      el('div', { class: 'section-actions' }, action('xpDropAdd', '＋ Add crate', 'primary')),
      el('div', { id: 'xpDropVariables', class: 'variable-guide' }),
      el('div', { class: 'preview-pair' },
        shortPreview('Crate appears', 'xpDropMessagePreview', 'xpDropEmojiToggle'),
        shortPreview('Claim confirmation', 'xpDropClaimPreview', 'xpClaimEmojiToggle')),
      el('div', { id: 'xpDropList', class: 'xp-drop-list' }),
      el('div', { class: 'test-row' },
        el('strong', {}, 'Try a crate first'),
        control('Crate', 'xpDropTestCrate', 'select'),
        control('Channel', 'xpDropTestChannel', 'select'),
        action('xpDropTestButton', 'Send test', 'quiet'))),
    section('Eligible channels', 'Only selected channels earn XP; each can have its own multiplier.',
      el('div', { id: 'levelingChannels', class: 'ignored-channel-list' })),
    section('Role boosts', 'The highest matching boost is applied to each member.',
      el('div', { class: 'section-actions' }, action('levelingAddBoost', '＋ Add boost')),
      el('div', { id: 'levelingBoosts', class: 'reward-list' })),
    section('Level rewards', 'Give milestone roles, either cumulatively or one at a time.',
      toggle('Keep earlier roles', 'levelingStackRewards', 'Stack each milestone role'),
      el('div', { class: 'section-actions' }, action('levelingAddReward', '＋ Add reward')),
      el('div', { id: 'levelingRewards', class: 'reward-list' })));
}

module.exports = leveling;
