function processLinearUpdate(obj) {
  const { action } = obj;
  const { identifier, priorityLabel, state, title } = obj.data;
  const { name } = state;

  if (action === "create") {
    return `${identifier} created: ${title}`;
  }

  if (action === "update") {
    return `${identifier} (${title}) updated to ${name} (${priorityLabel.toLowerCase()})`;
  }

  return obj.toString();
}

module.exports = processLinearUpdate;
