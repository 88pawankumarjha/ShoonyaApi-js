function convertToIST(time) {
    const inputTime = new Date(time);
    const istTime = new Date(inputTime.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    return istTime;
  }
  
  const isTimeBeforeorAfter = (compare, hours, mins) => {
    const inputTime = new Date();
  
    const istTime = convertToIST(inputTime);
  
    const curOffTime = convertToIST(inputTime);
    curOffTime.setHours(hours, mins);
  
    const res = compare == '<' ? istTime < curOffTime : istTime > curOffTime;
    console.log(res);
    return res;
  };
  
  const isTimeAfter330PM = () => {
    return isTimeBeforeorAfter('>', 15, 30);
  };
  
  console.log(isTimeAfter330PM());
  