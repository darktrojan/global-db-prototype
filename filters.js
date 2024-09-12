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
}

class SingleFolderFilter {
  folder;
  rowid;

  constructor(folder) {
    this.folder = folder;
    this.rowid = folder.rowid;
  }

  get sqlClause() {
    return "folder = :folder";
  }
  get sqlArgs() {
    return { folder: this.rowid };
  };
  matches(message) {
    return message.folder == this.rowid;
  }
}

class SingleFolderAndDescendantsFilter {
  folder;
  rowids; // TODO: needs to be maintained if the hierarchy changes.

  constructor(folder) {
    this.folder = folder;
    this.rowids = [folder.rowid, ...folder.descendants.map(f => f.rowid)];
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
