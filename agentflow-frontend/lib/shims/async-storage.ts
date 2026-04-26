const memoryStore = new Map<string, string>();

const AsyncStorage = {
  async getItem(key: string) {
    return memoryStore.get(key) ?? null;
  },
  async setItem(key: string, value: string) {
    memoryStore.set(key, value);
  },
  async removeItem(key: string) {
    memoryStore.delete(key);
  },
  async clear() {
    memoryStore.clear();
  },
};

export default AsyncStorage;
