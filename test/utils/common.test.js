// __tests__/mathOperations.test.js

const {isTimeEqualsNotAfterProps} = require('../../utils/customLibrary.js');

beforeIsTimeEqualsNotAfterProps = () => {
  // Mock the current date and time
  const mockDate = new Date();
  mockDate.setHours(15);
  mockDate.setMinutes(30);
  jest.spyOn(global, 'Date').mockImplementation(() => mockDate);
}

afterIsTimeEqualsNotAfterProps = () => {
  // Restore the original Date implementation
  global.Date.mockRestore();
}

it('should return true when current time is same as input time and isEqualNotAfter is true', () => {
  
  beforeIsTimeEqualsNotAfterProps()
  // Call the function
  const result = isTimeEqualsNotAfterProps(15, 30, true);

  // Assert the result
  expect(result).toBe(true);
  afterIsTimeEqualsNotAfterProps()
});

it('should return true when current time is before/after input time and isEqualNotAfter is false', () => {
  beforeIsTimeEqualsNotAfterProps()
  const result = isTimeEqualsNotAfterProps(15, 28, false);
  expect(result).toBe(true);
  const result2 = isTimeEqualsNotAfterProps(15, 32, false);
  expect(result2).toBe(false);
  afterIsTimeEqualsNotAfterProps()
});