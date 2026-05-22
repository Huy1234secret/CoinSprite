with open("commands/00z-fishy-market-value-patch.js", "r") as f:
    text = f.read()

# Replace any occurrence of `${` with `\${` in the template strings if it wasn't escaped correctly
text = text.replace("`${displayChartValue", "`\\${displayChartValue")

with open("commands/00z-fishy-market-value-patch.js", "w") as f:
    f.write(text)
