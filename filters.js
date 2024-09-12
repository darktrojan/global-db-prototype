/* eslint-env es2023 */
class LiveView {
  filters = [];

  get sqlClause() {
    return this.filters.map(filter => filter.sqlClause).join(" AND ");
  }
  get sqlArgs() {
    return this.filters.reduce((filters, current) => {
      for (const [name, value] of Object.entries(current.sqlArgs)) {
        filters[name] = value;
      }
      return filters;
    }, {});
  }
  matches(message) {
    return this.filters.every(filter => filter.matches(message));
  }

  run() {
    const stmt = connection.createStatement(`SELECT * FROM messages WHERE ${this.sqlClause}`);
    for (const [name, value] of Object.entries(this.sqlArgs)) {
      stmt.params[name] = value;
    }
    while (stmt.executeStep()) {
      const row = stmt.row;
      console.log(row);
    }
  }
}

class SingleFolderFilter {
  folder;
  id;

  constructor(folder) {
    this.folder = folder;
    this.id = folder.id;
  }

  get sqlClause() {
    return "folder = :folder";
  }
  get sqlArgs() {
    return { folder: this.id };
  };
  matches(message) {
    return message.folder == this.id;
  }
}

class SingleFolderAndDescendantsFilter {
  folder;
  rowids; // TODO: needs to be maintained if the hierarchy changes.

  constructor(folder) {
    this.folder = folder;
    this.rowids = [folder.id, ...folder.descendants.map(f => f.id)];
  }

  get sqlClause() {
    return "folder IN (SELECT id FROM folders WHERE lft >= :lft AND rgt <= :rgt)";
  }
  get sqlArgs() {
    return { lft: this.folder.left, rgt: this.folder.right };
  }
  matches(message) {
    return this.rowids.includes(message.folder);
  }
}

class UnreadMessagesFilter {
  get sqlClause() {
    return "flags & :unread_flag = 0"
  }
  get sqlArgs() {
    return { unread_flag: Ci.nsMsgMessageFlags.Read }
  }
  matches(message) {
    return (message.flags & Ci.nsMsgMessageFlags.Read) == 0;
  }
}

// QUESTION: should LiveView and some filters be made immutable once they're defined?
// It would save repeatedly computing things that aren't going to change.
