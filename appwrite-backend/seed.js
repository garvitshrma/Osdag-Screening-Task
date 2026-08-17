    require('dotenv').config();
const fs = require('fs');
const path = require('path');
const sdk = require('node-appwrite');
const { Client, Users, Databases, Storage, ID, Permission, Role, Query } = sdk;

// InputFile moved between SDK versions — try both locations.
let InputFile;
try { InputFile = require('node-appwrite/file').InputFile; }
catch { InputFile = sdk.InputFile; }

const {
  APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY,
  APPWRITE_DATABASE_ID, APPWRITE_FILES_COLLECTION_ID, APPWRITE_BUCKET_ID,
} = process.env;

const client = new Client()
  .setEndpoint(APPWRITE_ENDPOINT)
  .setProject(APPWRITE_PROJECT_ID)
  .setKey(APPWRITE_API_KEY);

const users = new Users(client);
const databases = new Databases(client);
const storage = new Storage(client);

const DB = APPWRITE_DATABASE_ID;
const COLL = APPWRITE_FILES_COLLECTION_ID;
const BUCKET = APPWRITE_BUCKET_ID;

// Make the script safe to re-run: wipe existing files, docs, and the 3 users.
async function clearExisting(seedUsers) {
  const docs = await databases.listDocuments(DB, COLL);
  for (const d of docs.documents) await databases.deleteDocument(DB, COLL, d.$id);

  const files = await storage.listFiles(BUCKET);
  for (const f of files.files) await storage.deleteFile(BUCKET, f.$id);

  for (const u of seedUsers) {
    const res = await users.list([Query.equal('email', u.email)]);
    for (const existing of res.users) await users.delete(existing.$id);
  }
}

async function main() {
  const seedPath = path.join(__dirname, '..', 'web-client', 'seed-data.json');
  const data = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));

  await clearExisting(data.users);

  for (const u of data.users) {
    // Appwrite creates the user AND hashes the password (argon2) for us.
    const user = await users.create(
      ID.unique(), u.email, undefined, u.password, u.profile.fullName || u.email
    );
    const userId = user.$id;

    for (const f of u.files) {
      const content = Buffer.from(`Placeholder contents for ${f.fileName}.\n`, 'utf-8');

      // Upload the bytes, readable ONLY by the owner (this is the isolation stamp).
      const stored = await storage.createFile(
        BUCKET, ID.unique(), InputFile.fromBuffer(content, f.fileName),
        [Permission.read(Role.user(userId))]
      );

      // Create the metadata row, also readable ONLY by the owner.
      await databases.createDocument(
        DB, COLL, ID.unique(),
        {
          ownerId: userId,
          fileName: f.fileName,
          mimeType: f.mimeType,
          sizeBytes: f.sizeBytes,
          storageFileId: stored.$id,
        },
        [Permission.read(Role.user(userId))]
      );
    }

    console.log(`Seeded ${u.email} (${userId}) with ${u.files.length} files`);
  }

  console.log('Done seeding Appwrite.');
}

main().catch((err) => { console.error(err); process.exit(1); });