import { Client, Account, Databases, Storage, Query, ID } from "https://esm.sh/appwrite@17";

const APPWRITE_ENDPOINT = "https://fra.cloud.appwrite.io/v1";
const APPWRITE_PROJECT_ID = "6a2f3ae5000560f23d0c";

const DATABASE_ID = "ebook_catalog";
const TABLE_ID = "books";
const BUCKET_ID = "covers";

const client = new Client()
    .setEndpoint(APPWRITE_ENDPOINT)
    .setProject(APPWRITE_PROJECT_ID);

const account = new Account(client);
const databases = new Databases(client);
const storage = new Storage(client);

export { client, account, databases, storage, Query, ID, DATABASE_ID, TABLE_ID, BUCKET_ID };