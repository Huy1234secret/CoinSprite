with open("commands/00z-fishy-market-value-patch.js", "r") as f:
    text = f.read()

# Replace `${entry.type` with `\${entry.type`
text = text.replace("`${entry.type", "`\\${entry.type")

with open("commands/00z-fishy-market-value-patch.js", "w") as f:
    f.write(text)
