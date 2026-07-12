'use strict';

function assignGuests(tables, guests) {
  const assignments = [];
  for (const guest of guests) {
    for (const table of tables) {
      const usedSeats = assignments.filter((assignment) => assignment.tableId === table.id)
        .reduce((sum, assignment) => sum + assignment.size, 0);
      if (usedSeats + guest.size <= table.capacity) {
        assignments.push({ guestId: guest.id, tableId: table.id, size: guest.size });
        break;
      }
    }
  }
  return assignments;
}

module.exports = { assignGuests };
