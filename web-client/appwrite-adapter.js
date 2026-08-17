(function () {
  // Read config from the "Appwrite settings" fields in index.html
  function cfg() {
    return {
      endpoint:     document.getElementById('awEndpoint').value.trim(),
      projectId:    document.getElementById('awProjectId').value.trim(),
      databaseId:   document.getElementById('awDatabaseId').value.trim(),
      collectionId: document.getElementById('awFilesCollectionId').value.trim(),
      bucketId:     document.getElementById('awBucketId').value.trim(),
    };
  }

  function appwriteEnabled() {
    const r = document.querySelector('input[name="backendMode"][value="appwrite"]');
    return r && r.checked;
  }

  function services() {
    const c = cfg();
    const client = new Appwrite.Client().setEndpoint(c.endpoint).setProject(c.projectId);
    return {
      c,
      account:   new Appwrite.Account(client),
      databases: new Appwrite.Databases(client),
      storage:   new Appwrite.Storage(client),
    };
  }

  function json(status, body) {
    return new Response(JSON.stringify(body), {
      status, headers: { 'Content-Type': 'application/json' },
    });
  }

  function mapDoc(d) {
    return {
      id: d.$id, ownerId: d.ownerId, fileName: d.fileName,
      mimeType: d.mimeType, sizeBytes: d.sizeBytes,
      storageFileId: d.storageFileId, uploadedAt: d.$createdAt,
    };
  }

  const prevFetch = window.fetch.bind(window);

  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : input.url;
    const u = new URL(url, window.location.href);
    const pathname = u.pathname;
    const method = (init && init.method) || 'GET';

    // Only intercept our own app routes; let the Appwrite SDK's calls (/v1/...) pass through.
    const isAppRoute = /^\/(register|login|logout|me|files)(\/.*)?$/.test(pathname);
    if (!appwriteEnabled() || !isAppRoute) {
      return prevFetch(input, init);
    }

    const { account, databases, storage, c } = services();

    try {
      if (pathname === '/register' && method === 'POST') {
        const { email, password } = JSON.parse(init.body);
        const u = await account.create(Appwrite.ID.unique(), email, password);
        return json(201, { id: u.$id, email: u.email });
      }

      if (pathname === '/login' && method === 'POST') {
        const { email, password } = JSON.parse(init.body);
        try { await account.deleteSession('current'); } catch (e) {}   // clear stale session
        const s = await account.createEmailPasswordSession(email, password);
        const me = await account.get();
        return json(200, { token: s.$id, user: { id: me.$id, email: me.email } });
      }

      if (pathname === '/logout' && method === 'POST') {
        await account.deleteSession('current');
        return json(200, { message: 'Logged out' });
      }

      if (pathname === '/me' && method === 'GET') {
        const me = await account.get();
        return json(200, {
          id: me.$id, email: me.email,
          profile: { displayName: me.name, createdAt: me.$createdAt },
        });
      }

      if (pathname === '/files' && method === 'GET') {
        // Appwrite returns ONLY documents this user is permitted to read -> isolation, no filter written.
        const res = await databases.listDocuments(c.databaseId, c.collectionId);
        return json(200, { files: res.documents.map(mapDoc) });
      }

      let m = pathname.match(/^\/files\/([^/]+)\/download$/);
      if (m && method === 'GET') {
        let doc;
        try { doc = await databases.getDocument(c.databaseId, c.collectionId, m[1]); }
        catch (e) { return json(404, { error: 'Not found or not accessible' }); }
        const dl = storage.getFileDownload(c.bucketId, doc.storageFileId);
        return prevFetch(dl.toString(), { credentials: 'include' });   // stream the bytes
      }

      m = pathname.match(/^\/files\/([^/]+)$/);
      if (m && method === 'GET') {
        try {
          const doc = await databases.getDocument(c.databaseId, c.collectionId, m[1]);
          return json(200, { file: mapDoc(doc) });
        } catch (e) {
          // Appwrite returns 404 for BOTH "missing" and "not yours" (hides existence).
          return json(404, { error: 'File not found or not accessible' });
        }
      }

      return json(404, { error: 'No adapter route for ' + method + ' ' + pathname });
    } catch (err) {
      console.error('[appwrite-adapter] error:', err);
      return json(err.code || 400, {
        error: err.message || String(err),
        type: err.type || null,
      });
    }
  };

  console.info('[appwrite-adapter] ready — select "Appwrite" mode');
})();