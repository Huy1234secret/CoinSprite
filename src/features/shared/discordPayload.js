const { MessageFlags } = require("discord.js");

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32_768;

const DISCORD_MESSAGE_LIMITS = Object.freeze({
  buttonLabel: 80,
  componentCustomId: 100,
  components: 40,
  content: 2_000,
  embedAuthorName: 256,
  embedDescription: 4_096,
  embedFieldName: 256,
  embedFieldValue: 1_024,
  embedFields: 25,
  embedFooterText: 2_048,
  embeds: 10,
  embedTitle: 256,
  embedTotal: 6_000,
  labelDescription: 100,
  labelText: 45,
  selectDescription: 100,
  selectLabel: 100,
  selectOptions: 25,
  selectPlaceholder: 150,
  selectValue: 100,
  textDisplay: 4_000,
});

function componentChildren(component, path) {
  const children = [];
  const nested = Array.isArray(component?.components)
    ? component.components
    : [];
  for (const [index, child] of nested.entries()) {
    children.push([child, `${path}.components[${index}]`]);
  }
  if (component?.accessory)
    children.push([component.accessory, `${path}.accessory`]);
  if (component?.component)
    children.push([component.component, `${path}.component`]);
  return children;
}

function walkComponents(components, visitor, basePath = "components") {
  function visit(component, path) {
    visitor(component, path);
    for (const [child, childPath] of componentChildren(component, path))
      visit(child, childPath);
  }
  const roots = Array.isArray(components) ? components : [];
  for (const [index, component] of roots.entries())
    visit(component, `${basePath}[${index}]`);
}

function embedCharacterCount(embed) {
  const fields = Array.isArray(embed?.fields) ? embed.fields : [];
  return [
    embed?.title,
    embed?.description,
    embed?.footer?.text,
    embed?.author?.name,
    ...fields.flatMap((field) => [field?.name, field?.value]),
  ].reduce(
    (sum, value) => sum + (typeof value === "string" ? value.length : 0),
    0,
  );
}

function payloadMetrics(payload = {}) {
  const embeds = Array.isArray(payload.embeds) ? payload.embeds : [];
  const metrics = {
    contentChars:
      typeof payload.content === "string" ? payload.content.length : 0,
    embeds: embeds.length,
    embedChars: embeds.reduce(
      (sum, embed) => sum + embedCharacterCount(embed),
      0,
    ),
    embedDescriptions: embeds.map(
      (embed) => String(embed?.description || "").length,
    ),
    embedFields: embeds.map((embed) =>
      Array.isArray(embed?.fields) ? embed.fields.length : 0,
    ),
    components: 0,
    textDisplays: 0,
    componentTextChars: 0,
    labels: [],
    customIds: [],
    selectOptions: 0,
  };
  walkComponents(payload.components, (component) => {
    metrics.components += 1;
    if (component?.type === 10) {
      metrics.textDisplays += 1;
      metrics.componentTextChars += String(component.content || "").length;
    }
    if (typeof component?.label === "string")
      metrics.labels.push(component.label.length);
    if (typeof component?.custom_id === "string")
      metrics.customIds.push(component.custom_id.length);
    if (Array.isArray(component?.options))
      metrics.selectOptions += component.options.length;
  });
  return metrics;
}

function lengthError(errors, path, value, maximum) {
  if (typeof value === "string" && value.length > maximum) {
    errors.push({
      path,
      message: `must be ${maximum} characters or fewer (received ${value.length})`,
    });
  }
}

function messagePayloadErrors(payload = {}) {
  const errors = [];
  const embeds = Array.isArray(payload.embeds) ? payload.embeds : [];
  const customIds = new Map();
  const flags = Number(payload.flags || 0);

  lengthError(
    errors,
    "content",
    payload.content,
    DISCORD_MESSAGE_LIMITS.content,
  );
  if (embeds.length > DISCORD_MESSAGE_LIMITS.embeds) {
    errors.push({
      path: "embeds",
      message: `must contain at most ${DISCORD_MESSAGE_LIMITS.embeds} embeds (received ${embeds.length})`,
    });
  }
  let totalEmbedCharacters = 0;
  for (const [index, embed] of embeds.entries()) {
    const path = `embeds[${index}]`;
    lengthError(
      errors,
      `${path}.title`,
      embed?.title,
      DISCORD_MESSAGE_LIMITS.embedTitle,
    );
    lengthError(
      errors,
      `${path}.description`,
      embed?.description,
      DISCORD_MESSAGE_LIMITS.embedDescription,
    );
    lengthError(
      errors,
      `${path}.footer.text`,
      embed?.footer?.text,
      DISCORD_MESSAGE_LIMITS.embedFooterText,
    );
    lengthError(
      errors,
      `${path}.author.name`,
      embed?.author?.name,
      DISCORD_MESSAGE_LIMITS.embedAuthorName,
    );
    const fields = Array.isArray(embed?.fields) ? embed.fields : [];
    if (fields.length > DISCORD_MESSAGE_LIMITS.embedFields) {
      errors.push({
        path: `${path}.fields`,
        message: `must contain at most ${DISCORD_MESSAGE_LIMITS.embedFields} fields (received ${fields.length})`,
      });
    }
    for (const [fieldIndex, field] of fields.entries()) {
      lengthError(
        errors,
        `${path}.fields[${fieldIndex}].name`,
        field?.name,
        DISCORD_MESSAGE_LIMITS.embedFieldName,
      );
      lengthError(
        errors,
        `${path}.fields[${fieldIndex}].value`,
        field?.value,
        DISCORD_MESSAGE_LIMITS.embedFieldValue,
      );
    }
    totalEmbedCharacters += embedCharacterCount(embed);
  }
  if (totalEmbedCharacters > DISCORD_MESSAGE_LIMITS.embedTotal) {
    errors.push({
      path: "embeds",
      message: `must contain at most ${DISCORD_MESSAGE_LIMITS.embedTotal} total characters (received ${totalEmbedCharacters})`,
    });
  }

  let componentCount = 0;
  walkComponents(payload.components, (component, path) => {
    componentCount += 1;
    if (component?.type === 10) {
      const content =
        typeof component.content === "string" ? component.content : "";
      if (!content.length)
        errors.push({ path: `${path}.content`, message: "must not be empty" });
      lengthError(
        errors,
        `${path}.content`,
        content,
        DISCORD_MESSAGE_LIMITS.textDisplay,
      );
    }
    const requiresCustomId =
      [3, 4, 5, 6, 7, 8, 19, 21, 22, 23].includes(component?.type) ||
      (component?.type === 2 && [1, 2, 3, 4].includes(component?.style));
    if (requiresCustomId && typeof component?.custom_id !== "string") {
      errors.push({
        path: `${path}.custom_id`,
        message: "is required for this interactive component",
      });
    }
    if (typeof component?.custom_id === "string") {
      if (!component.custom_id.length)
        errors.push({
          path: `${path}.custom_id`,
          message: "must not be empty",
        });
      lengthError(
        errors,
        `${path}.custom_id`,
        component.custom_id,
        DISCORD_MESSAGE_LIMITS.componentCustomId,
      );
      const firstPath = customIds.get(component.custom_id);
      if (firstPath) {
        errors.push({
          path: `${path}.custom_id`,
          message: `must be unique; it duplicates ${firstPath}.custom_id`,
        });
      } else customIds.set(component.custom_id, path);
    }
    if (component?.type === 2) {
      lengthError(
        errors,
        `${path}.label`,
        component.label,
        DISCORD_MESSAGE_LIMITS.buttonLabel,
      );
      if (
        !String(component.label || "").length &&
        !component.emoji &&
        component.style !== 6
      ) {
        errors.push({
          path: `${path}.label`,
          message: "or emoji is required for a button",
        });
      }
    }
    if (component?.type === 18) {
      if (!String(component.label || "").length)
        errors.push({ path: `${path}.label`, message: "must not be empty" });
      lengthError(
        errors,
        `${path}.label`,
        component.label,
        DISCORD_MESSAGE_LIMITS.labelText,
      );
      lengthError(
        errors,
        `${path}.description`,
        component.description,
        DISCORD_MESSAGE_LIMITS.labelDescription,
      );
    }
    if (component?.type === 1) {
      const children = Array.isArray(component.components)
        ? component.components
        : [];
      const hasSelect = children.some((child) =>
        [3, 5, 6, 7, 8].includes(child?.type),
      );
      const validRow = hasSelect
        ? children.length === 1 && [3, 5, 6, 7, 8].includes(children[0]?.type)
        : children.length >= 1 &&
          children.length <= 5 &&
          children.every((child) => child?.type === 2);
      if (!validRow)
        errors.push({
          path: `${path}.components`,
          message:
            "must contain one select menu or between one and five buttons",
        });
    }
    if (component?.type === 3) {
      const options = Array.isArray(component.options) ? component.options : [];
      if (
        !options.length ||
        options.length > DISCORD_MESSAGE_LIMITS.selectOptions
      ) {
        errors.push({
          path: `${path}.options`,
          message: `must contain between 1 and ${DISCORD_MESSAGE_LIMITS.selectOptions} options (received ${options.length})`,
        });
      }
      lengthError(
        errors,
        `${path}.placeholder`,
        component.placeholder,
        DISCORD_MESSAGE_LIMITS.selectPlaceholder,
      );
      const minimum =
        component.min_values === undefined ? 1 : Number(component.min_values);
      const maximum =
        component.max_values === undefined ? 1 : Number(component.max_values);
      if (
        !Number.isInteger(minimum) ||
        minimum < 0 ||
        minimum > DISCORD_MESSAGE_LIMITS.selectOptions
      ) {
        errors.push({
          path: `${path}.min_values`,
          message: `must be between 0 and ${DISCORD_MESSAGE_LIMITS.selectOptions}`,
        });
      }
      if (
        !Number.isInteger(maximum) ||
        maximum < 1 ||
        maximum > DISCORD_MESSAGE_LIMITS.selectOptions ||
        maximum < minimum
      ) {
        errors.push({
          path: `${path}.max_values`,
          message: `must be between the minimum and ${DISCORD_MESSAGE_LIMITS.selectOptions}`,
        });
      }
      for (const [optionIndex, option] of options.entries()) {
        const optionPath = `${path}.options[${optionIndex}]`;
        if (!String(option?.label || "").length)
          errors.push({
            path: `${optionPath}.label`,
            message: "must not be empty",
          });
        if (!String(option?.value || "").length)
          errors.push({
            path: `${optionPath}.value`,
            message: "must not be empty",
          });
        lengthError(
          errors,
          `${optionPath}.label`,
          option?.label,
          DISCORD_MESSAGE_LIMITS.selectLabel,
        );
        lengthError(
          errors,
          `${optionPath}.value`,
          option?.value,
          DISCORD_MESSAGE_LIMITS.selectValue,
        );
        lengthError(
          errors,
          `${optionPath}.description`,
          option?.description,
          DISCORD_MESSAGE_LIMITS.selectDescription,
        );
      }
    }
  });
  if (componentCount > DISCORD_MESSAGE_LIMITS.components) {
    errors.push({
      path: "components",
      message: `must contain at most ${DISCORD_MESSAGE_LIMITS.components} total components (received ${componentCount})`,
    });
  }
  if ((flags & COMPONENTS_V2_FLAG) !== 0) {
    if (typeof payload.content === "string" && payload.content.length) {
      errors.push({
        path: "content",
        message: "must be empty when IS_COMPONENTS_V2 is set",
      });
    }
    if (embeds.length)
      errors.push({
        path: "embeds",
        message: "must be empty when IS_COMPONENTS_V2 is set",
      });
  }
  return errors;
}

function assertValidMessagePayload(payload) {
  const errors = messagePayloadErrors(payload);
  if (!errors.length) return payload;
  const error = Object.assign(
    new RangeError(
      `Invalid Discord message payload:\n- ${errors.map((item) => `${item.path}: ${item.message}`).join("\n- ")}`,
    ),
    { validationErrors: errors, payloadMetrics: payloadMetrics(payload) },
  );
  throw error;
}

module.exports = {
  DISCORD_MESSAGE_LIMITS,
  assertValidMessagePayload,
  embedCharacterCount,
  messagePayloadErrors,
  payloadMetrics,
  walkComponents,
};
