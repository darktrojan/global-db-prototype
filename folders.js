/* eslint-env es2023 */
var file = new FileUtils.File("/home/geoff/mozilla/folders/folders.sqlite");
var connection = Services.storage.openDatabase(file);

var FolderController = {
  folders: new Map(),

  reload() {
    this.folders.clear();
    let parent = null;

    const stmt = connection.createStatement("SELECT rowid, name, lft, rgt, flags FROM folders ORDER BY lft ASC");
    while (stmt.executeStep()) {
      const row = stmt.row;
      let current = this.folders.get(row.rowid);
      if (current) {
        current.name = row.name;
        current.left = row.lft;
        current.right = row.rgt;
        current.flags = row.flags;
      } else {
        current = new FolderObject(row.rowid, row.name, row.lft, row.rgt, row.flags);
        this.folders.set(row.rowid, current);
      }

      while (parent && current.left > parent.right) {
        parent = parent.parent;
      }

      current.parent = parent;
      if (parent) {
        parent.children.push(current)
      }
      parent = current;
    }
    stmt.reset();
    stmt.finalize();
  },

  findAncestors(left, right) {
    const ancestors = [];
    const stmt = connection.createStatement("SELECT rowid FROM folders WHERE lft < :lft AND rgt > :rgt ORDER BY lft DESC");
    stmt.params.lft = left;
    stmt.params.rgt = right;
    while (stmt.executeStep()) {
      ancestors.push(this.folders.get(stmt.row.rowid));
    }
    stmt.reset();
    stmt.finalize();
    return ancestors;
  },

  findDescendants(left, right) {
    const descendants = [];
    const stmt = connection.createStatement("SELECT rowid FROM folders WHERE lft > :lft AND rgt < :rgt ORDER BY lft ASC");
    stmt.params.lft = left;
    stmt.params.rgt = right;
    while (stmt.executeStep()) {
      descendants.push(this.folders.get(stmt.row.rowid));
    }
    stmt.reset();
    stmt.finalize();
    return descendants;
  },

  /**
   * Move a folder to any point within the hierarchy that isn't within the folder.
   *
   * To visualise this, think of the folder as one block of numbers on a number line
   * (e.g. 34-37) and the numbers between the folder and it's new position as an
   * adjacent block of numbers (e.g. 38-45). Now swap the blocks. To the left and
   * right values of the folder and its descendants add 8, to every left and right
   * value within the adjacent block subtract 4. The folder is now 42-45 and the
   * others are 34-41.
   */
  move({ left: childLeft, right: childRight }, { newLeft, newRight }) {
    if (newLeft === undefined && newRight === undefined) {
      throw new Error("newLeft and newRight are both undefined");
    }
    if (newLeft !== undefined && newRight !== undefined) {
      throw new Error("newLeft and newRight are both defined");
    }

    let childSize = childRight - childLeft + 1;
    let adjacentLeft, adjacentRight, adjacentSize;
    if (newLeft) {
      if (newLeft >= childLeft && newLeft <= childRight) {
        throw new Error(`newLeft (${newLeft}) is within child (${childLeft}-${childRight}`);
      }
      adjacentLeft = newLeft;
      adjacentRight = childLeft - 1;
      adjacentSize = newLeft - childLeft; // A negative number. Moves child left.
    } else {
      if (newRight >= childLeft && newRight <= childRight) {
        throw new Error(`newRight (${newRight}) is within child (${childLeft}-${childRight}`);
      }
      childSize *= -1; // A negative number. Moves adjacent left.
      adjacentLeft = childRight + 1;
      adjacentRight = newRight;
      adjacentSize = newRight - childRight;
    }

    connection.beginTransaction();
    try {
      // Remember the rows of the folder and its descendants.
      let stmt = connection.createStatement("CREATE TEMPORARY TABLE foo AS SELECT rowid FROM folders WHERE lft >= :childLeft AND rgt <= :childRight");
      stmt.params.childLeft = childLeft;
      stmt.params.childRight = childRight;
      stmt.execute();

      // Shift all lft values in the adjacent block by the size of the folder block.
      stmt = connection.createStatement("UPDATE folders SET lft=lft + :childSize WHERE lft >= :adjacentLeft AND lft <= :adjacentRight RETURNING rowid, lft");
      stmt.params.childSize = childSize;
      stmt.params.adjacentLeft = adjacentLeft;
      stmt.params.adjacentRight = adjacentRight;
      while (stmt.executeStep()) {
        const row = stmt.row;
        const folder = this.folders.get(row.rowid);
        folder.left = row.lft;
      }

      // Shift all rgt values in the adjacent block by the size of the folder block.
      stmt = connection.createStatement("UPDATE folders SET rgt=rgt + :childSize WHERE rgt >= :adjacentLeft AND rgt <= :adjacentRight RETURNING rowid, rgt");
      stmt.params.childSize = childSize;
      stmt.params.adjacentLeft = adjacentLeft;
      stmt.params.adjacentRight = adjacentRight;
      while (stmt.executeStep()) {
        const row = stmt.row;
        const folder = this.folders.get(row.rowid);
        folder.right = row.rgt;
      }

      // Shift all rows for the folder by the size of the adjacent block.
      stmt = connection.createStatement("UPDATE folders SET lft=lft + :adjacentSize, rgt=rgt + :adjacentSize WHERE rowid IN foo RETURNING rowid, lft, rgt");
      stmt.params.adjacentSize = adjacentSize;
      while (stmt.executeStep()) {
        const row = stmt.row;
        const folder = this.folders.get(row.rowid);
        folder.left = row.lft;
        folder.right = row.rgt;
      }

      connection.executeSimpleSQL("DROP TABLE foo");

      connection.commitTransaction();
      // this.reload();
    } catch (ex) {
      connection.rollbackTransaction();
      throw ex;
    }
  },

  create(name, at) {
    connection.beginTransaction();
    try {
      let stmt = connection.createStatement("UPDATE folders SET lft = lft + 2 WHERE lft >= :at RETURNING rowid, lft");
      stmt.params.at = at;
      while (stmt.executeStep()) {
        const row = stmt.row;
        const folder = this.folders.get(row.rowid);
        folder.left = row.lft;
      }

      stmt = connection.createStatement("UPDATE folders SET rgt = rgt + 2 WHERE rgt >= :at RETURNING rowid, rgt");
      stmt.params.at = at;
      while (stmt.executeStep()) {
        const row = stmt.row;
        const folder = this.folders.get(row.rowid);
        folder.right = row.rgt;
      }

      stmt = connection.createStatement("INSERT INTO folders (name, lft, rgt) VALUES (:name, :at, :at + 1)");
      stmt.params.name = name;
      stmt.params.at = at;
      stmt.execute();

      connection.commitTransaction();
      // Still need to reload to create a new FolderObject and add it to the parent's `children`
      // array in the right place, but this need will disappear once we hook this function up to
      // things – it's not meant to be called directly.
      this.reload();
    } catch (ex) {
      connection.rollbackTransaction();
      throw ex;
    }
  },

  delete(left, right) {
    connection.beginTransaction();
    try {
      stmt = connection.createStatement("DELETE FROM folders WHERE lft BETWEEN :lft AND :rgt");
      stmt.params.lft = left;
      stmt.params.rgt = right;
      stmt.execute();

      stmt = connection.createStatement("UPDATE folders SET lft = lft - :size WHERE lft > :rgt RETURNING rowid, lft");
      stmt.params.size = right - left + 1;
      stmt.params.rgt = right;
      while (stmt.executeStep()) {
        const row = stmt.row;
        const folder = this.folders.get(row.rowid);
        folder.left = row.lft;
      }

      stmt = connection.createStatement("UPDATE folders SET rgt = rgt - :size WHERE rgt > :rgt RETURNING rowid, rgt");
      stmt.params.size = right - left + 1;
      stmt.params.rgt = right;
      while (stmt.executeStep()) {
        const row = stmt.row;
        const folder = this.folders.get(row.rowid);
        folder.right = row.rgt;
      }

      connection.commitTransaction();
      // Still need to reload to remove the FolderObject from various places, but this need will
      // disappear once we hook this function up to things – it's not meant to be called directly.
      this.reload();
    } catch (ex) {
      connection.rollbackTransaction();
      throw ex;
    }
  },

  dump() {
    const stmt = connection.createStatement("SELECT rowid, * FROM folders ORDER BY lft ASC");
    while (stmt.executeStep()) {
      console.log(stmt.row);
    }
  }
};

class FolderObject {
  children = [];

  constructor(rowid, name, left, right, flags) {
    this.rowid = rowid;
    this.name = name;
    this.left = left;
    this.right = right;
    this.flags = flags;
  }

  get fullName() {
    if (!this.parent) {
      return "root";
    }
    return `${this.parent.fullName}/${this.name}`;
  }

  get ancestors() {
    return FolderController.findAncestors(this.left, this.right);
  }

  isDescendantOf(other) {
    return this.left > other.left && this.right < other.right;
  }

  get descendants() {
    return FolderController.findDescendants(this.left, this.right);
  }

  isAncestorOf(other) {
    return this.left < other.left && this.right > other.right;
  }

  get type() {
    for (let [f, l] of [
      [0x00000100, "Trash"],
      [0x00000200, "SentMail"],
      [0x00000400, "Drafts"],
      [0x00000800, "Queue"],
      [0x00001000, "Inbox"],
      [0x00004000, "Archive"],
      [0x00400000, "Templates"],
      [0x40000000, "Junk"],
    ]) {
      if (this.flags & f) {
        return l;
      }
    }
    return "";
  }

  get nearestType() {
    const thisType = this.type;
    return thisType || this.parent?.nearestType || "";
  }

  insert(child, before) {
    if (!before) {
      if (child.left > this.right) {
        FolderController.move(child, { newLeft: this.right });
      } else if (child.right == this.right - 1) {
        throw new Error(`${child.rowid} would not move`);
      } else {
        FolderController.move(child, { newRight: this.right - 1 });
      }

      child.parent.children.splice(child.parent.children.indexOf(child), 1);
      child.parent = this;
      this.children.push(child);

      return;
    }

    if (!this.children.includes(before)) {
      throw new Error(`${before.rowid} is not a child of ${this.rowid}`);
    }

    if (child.left > before.left) {
      FolderController.move(child, { newLeft: before.left });
    } else if (child.right == before.left - 1) {
      throw new Error(`${child.rowid} would not move`);
    } else {
      FolderController.move(child, { newRight: before.left - 1 });
    }

    child.parent.children.splice(child.parent.children.indexOf(child), 1);
    child.parent = this;
    this.children.splice(this.children.indexOf(before), 0, child);
  }

  drawTree(level = 0) {
    console.log(this.left, `${"  ".repeat(level)} [${this.rowid}] ${this.name} (${this.type}, ${this.nearestType})`);
    for (let subfolder of this.children) {
      subfolder.drawTree(level + 1);
    }
    console.log(this.right, `${"  ".repeat(level)} [${this.rowid}] /${this.name}`);
  }
}
