import { Client, Account, Databases, Storage, Query, ID } from "https://esm.sh/appwrite@17";

const APPWRITE_ENDPOINT = "https://fra.cloud.appwrite.io/v1";
const APPWRITE_PROJECT_ID = "6a2f3ae5000560f23d0c";

const DATABASE_ID = "6a2f3b38001d67193c7b";
const TABLE_ID = "books";
const BUCKET_ID = "6a2f3f66001896fe7d78";

// Yeni koleksiyonlar — yazar / yayınevi / seri listeleri.
// (Appwrite panelinde koleksiyon ID'leri bu adlarla oluşturuldu.)
const AUTHORS_ID = "authors";
const PUBLISHERS_ID = "publishers";
const SERIES_ID = "series";

const client = new Client()
    .setEndpoint(APPWRITE_ENDPOINT)
    .setProject(APPWRITE_PROJECT_ID);

const account = new Account(client);
const databases = new Databases(client);
const storage = new Storage(client);

export {
  client,
  account,
  databases,
  storage,
  Query,
  ID,
  APPWRITE_ENDPOINT,
  APPWRITE_PROJECT_ID,
  DATABASE_ID,
  TABLE_ID,
  BUCKET_ID,
  AUTHORS_ID,
  PUBLISHERS_ID,
  SERIES_ID,
};