/* eslint-env es2023 */
class LiveView {
  #folderFilter = null;
  #threadTypeFilter = null;
  quickFilters = [];

  // There can be only one folder filter, and only one thread type filter.
  // Once we start implementing this properly we can use strong typing and
  // some kind of interface or inheritance as gatekeeper here.

  get folderFilter() {
    return this.#folderFilter;
  }
  set folderFilter(filter) {
    if (
      !filter ||
      filter instanceof SingleFolderFilter ||
      filter instanceof SingleFolderAndDescendantsFilter ||
      filter instanceof MultiFolderFilter
    ) {
      this.#folderFilter = filter;
    } else {
      throw new Error("filter is not a folder filter");
    }
  }

  get threadTypeFilter() {
    return this.#threadTypeFilter;
  }
  set threadTypeFilter(filter) {
    if (
      !filter ||
      filter instanceof UnreadMessagesFilter
      // Threads with unread messages
      // Watched threads with unread messages
      // Ignored threads
    ) {
      this.#threadTypeFilter = filter;
    } else {
      throw new Error("filter is not a thread type filter");
    }
  }

  get allFilters() {
    return [this.#folderFilter, this.#threadTypeFilter, ...this.quickFilters].filter(Boolean);
  }
  get sqlClause() {
    return this.allFilters.map(filter => filter.sqlClause).join(" AND ");
  }
  get sqlArgs() {
    return this.allFilters.reduce((filters, current) => {
      for (const [name, value] of Object.entries(current.sqlArgs)) {
        filters[name] = value;
      }
      return filters;
    }, {});
  }
  matches(message) {
    return this.allFilters.every(filter => filter.matches(message));
  }

  count() {
    const stmt = connection.createStatement(`SELECT COUNT(*) AS count FROM messages WHERE ${this.sqlClause}`);
    for (const [name, value] of Object.entries(this.sqlArgs)) {
      stmt.params[name] = value;
    }
    stmt.executeStep();
    const row = stmt.row;
    console.log(row.count);
  }
  select() {
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
    return `folder = ${this.id}`;
  }
  get sqlArgs() {
    return {};
  };
  matches(message) {
    return message.folder == this.id;
  }
}

class SingleFolderAndDescendantsFilter {
  folder;
  ids; // TODO: needs to be maintained if the hierarchy changes.

  constructor(folder) {
    this.folder = folder;
    this.ids = [folder.id, ...folder.descendants.map(f => f.id)];
  }

  get sqlClause() {
    return "folder IN (SELECT id FROM folders WHERE lft >= :lft AND rgt <= :rgt)";
  }
  get sqlArgs() {
    return { lft: this.folder.left, rgt: this.folder.right };
  }
  matches(message) {
    return this.ids.includes(message.folder);
  }
}

class MultiFolderFilter {
  folders;
  ids;
  args;

  constructor(folders) {
    this.folders = folders;
    this.ids = folders.map(folder => folder.id);
    let i = 1;
    this.args = Object.fromEntries(folders.map(folder => [`folder${i++}`, folder.id]))
  }

  get sqlClause() {
    return `folder IN (${this.ids.join(", ")})`;
  }
  get sqlArgs() {
    return {};
  };
  matches(message) {
    return this.ids.includes(message.folder);
  }
}

// abstract
class MessageFlagsFilter {
  flag;
  wanted;

  get sqlClause() {
    return `flags & ${this.flag} = ${this.wanted}`;
  }
  get sqlArgs() {
    return {};
  }
  matches(message) {
    return (message.flags & this.flag) == this.wanted;
  }
}

class UnreadMessagesFilter extends MessageFlagsFilter {
  flag = Ci.nsMsgMessageFlags.Read;
  wanted = 0;
}

class FlaggedMessagesFilter extends MessageFlagsFilter {
  flag = Ci.nsMsgMessageFlags.Marked;
  wanted = Ci.nsMsgMessageFlags.Marked;
}

// QUESTION: should LiveView and some filters be made immutable once they're defined?
// It would save repeatedly computing things that aren't going to change.
