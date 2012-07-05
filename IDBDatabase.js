if (window.indexedDB.polyfill)
(function(window, indexedDB, util, undefined)
{
	var IDBDatabase = util.IDBDatabase = window.IDBDatabase = function (name, webdb)
	{
		this.name = name;
		this.version = null;
		this.objectStoreNames = new indexedDB.DOMStringList();
		this.onabort = null;
		this.onerror = null;
		this.onversionchange = null

		this._webdb = webdb;
		this._objectStores = null;
	};

	IDBDatabase.prototype.createObjectStore = function (name, optionalParameters)
	{
		validateVersionChangeTx(this._versionChangeTx);

		// Validate existence of ObjectStore
		if (this.objectStoreNames.indexOf(name) >= 0)
		{
			throw util.error("ConstraintError");
		}

		var params = optionalParameters || { };
		var keyPath = util.validateKeyPath(params.keyPath);
		var autoIncrement = params.autoIncrement && params.autoIncrement != false || false;

		if (autoIncrement && (keyPath === "" || (keyPath instanceof Array)))
		{
			throw util.error("InvalidAccessError");
		}
		return createObjectStore(this, name, keyPath, autoIncrement);
	};

	IDBDatabase.prototype.deleteObjectStore = function (name)
	{
		var tx = this._versionChangeTx;
		validateVersionChangeTx(tx);
		if (this.objectStoreNames.indexOf(name) == -1)
		{
			throw util.error("NotFoundError");
		}
		util.arrayRemove(this.objectStoreNames, name);
		var objectStore = this._objectStores[name];
		delete this._objectStores[name];
		var me = this;
		var errorCallback = function (tx, sqlError)
		{
			me.objectStoreNames.push(name);
			me._objectStores[name] = objectStore;
		};
		tx._enqueueRequest(function (sqlTx, nextRequestCallback)
		{
			sqlTx.executeSql("DROP TABLE \"" + name + "\"", null, null, errorCallback);
			sqlTx.executeSql("DELETE FROM " + indexedDB.SCHEMA_TABLE + " WHERE type = 'table' AND name = ?",
				[name], null, errorCallback);

			nextRequestCallback();
		});
	};

	IDBDatabase.prototype.transaction = function (storeNames, mode)
	{
		return new util.IDBTransaction(this, storeNames, mode || util.IDBTransaction.READ_ONLY);
	};

	IDBDatabase.prototype.close = function ()
	{
		return null;
	};

	IDBDatabase.prototype._loadObjectStores = function (sqlTx, successCallback, errorCallback)
	{
		var me = this;
		sqlTx.executeSql("SELECT * FROM " + indexedDB.SCHEMA_TABLE +
			" ORDER BY type DESC", null,
			function (sqlTx, resultSet)
			{
				me._objectStores = { };
				var item, objectStore;
				for (var i = 0; i < resultSet.rows.length; i++)
				{
					var item = resultSet.rows.item(i);
					if (item.type == "table")
					{
						me.objectStoreNames.push(item.name);
						objectStore = new util.IDBObjectStore(item.name, w_JSON.parse(item.keyPath), item.autoInc);
						objectStore._metaId = item.id;
						me._objectStores[item.name] = objectStore;
					}
					else if (item.type == "index")
					{
						for (var name in me._objectStores)
						{
							objectStore = me._objectStores[name];
							if (objectStore._metaId == item.tableId) break;
						}
						objectStore.indexNames.push(item.name);
						objectStore._indexes[item.name] = new util.IDBIndex(objectStore,
							item.name, item.keyPath, item.unique, item.multiEntry)
					}
				}
				if (successCallback) successCallback();
			},
			function (sqlTx, sqlError)
			{
				if (errorCallback) errorCallback(sqlError);
			});
	};

	// Utils
	var w_JSON = window.JSON;

	function validateVersionChangeTx(tx)
	{
		if (!tx || tx.mode !== util.IDBTransaction.VERSION_CHANGE)
		{
			throw util.error("InvalidStateError");
		}
	}

	function createObjectStore(me, name, keyPath, autoIncrement)
	{
		var objectStore = new util.IDBObjectStore(name, keyPath, autoIncrement, me._versionChangeTx);
		me.objectStoreNames.push(name);
		me._objectStores[name] = objectStore;
		var errorCallback = function (tx, sqlError)
		{
			util.arrayRemove(me.objectStoreNames, name);
			delete me._objectStores[name];
		};
		me._versionChangeTx._enqueueRequest(function (sqlTx, nextRequestCallback)
		{
			sqlTx.executeSql("CREATE TABLE \"" + name + "\" (id INTEGER PRIMARY KEY AUTOINCREMENT, " +
				"key TEXT, value BLOB)", [], null, errorCallback);

			sqlTx.executeSql("CREATE INDEX INDEX_" + name + "_key ON \"" + name + "\" (key)", [], null, errorCallback);

			sqlTx.executeSql("INSERT INTO " + indexedDB.SCHEMA_TABLE +
				" (type, name, keyPath, autoInc) VALUES ('table', ?, ?, ?)",
				[name, w_JSON.stringify(keyPath), autoIncrement ? 1 : 0],
				function (sqlTx, results)
				{
					objectStore._metaId = results.insertId;
				},
				errorCallback);

			nextRequestCallback();
		});
		return objectStore;
	}

}(window, window.indexedDB, window.indexedDB.util));