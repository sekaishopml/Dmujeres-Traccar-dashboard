import { createSlice } from '@reduxjs/toolkit';

const { reducer, actions } = createSlice({
  name: 'events',
  initialState: {
    items: [],
  },
  reducers: {
    add(state, action) {
      const existingIds = new Set(state.items.map((e) => e.id));
      const fresh = action.payload.filter((e) => !existingIds.has(e.id));
      state.items.unshift(...fresh);
      state.items.splice(50);
    },
    refresh(state, action) {
      state.items = action.payload.slice(0, 50);
    },
    delete(state, action) {
      state.items = state.items.filter((item) => item.id !== action.payload.id);
    },
    deleteAll(state) {
      state.items = [];
    },
  },
});

export { actions as eventsActions };
export { reducer as eventsReducer };
