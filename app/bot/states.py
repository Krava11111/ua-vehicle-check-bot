from aiogram.fsm.state import State, StatesGroup


class SearchStates(StatesGroup):
    plate = State()
    vin = State()
    insurance = State()
    plate_history = State()


class AdminStates(StatesGroup):
    broadcast = State()
