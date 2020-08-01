var translation_map = {
  ' is not connected to a word.': ' không kết nối với từ nào.',
  ' not found in dictionary.': ' không tìm thấy trong từ điển.',
  ' points per turn': ' số điểm một lượt',
  'Clear': 'Xóa',
  'Computer can score up to ': 'Máy tính có thể ghi số điểm lên tới ',
  'Computer thinking, please wait...': 'Máy tính đang nghĩ, xin chờ...',
  'Computer wins.': 'Máy tính thắng.',
  'Computer&rsquo;s last score:': 'Điểm lượt cuối của máy:',
  'Computer&rsquo;s total score:': 'Tổng điểm của máy:',
  'Computer: ': 'Máy tính: ',
  'Decrease difficulty': 'Giảm độ khó',
  'Default': 'Mặc Định',
  'Dictionary inconsistency detected.': 'Lỗi không đồng nhất với từ điển.',
  'English': 'Tiếng Anh',
  'Feedback?': 'Ý kiến phản hồi?',
  'first word must be on the star.': 'từ đầu tiên phải đi qua ngôi sao.',
  'Game over. The score is...': 'Trò chơi kết thúc. Số điểm là...',
  'Hide computer&rsquo;s rack': 'Giấu khay chữ của máy',
  'I pass, your turn.': 'Tôi bỏ lượt, đến lượt của bạn.',
  'Increase difficulty': 'Tăng độ khó',
  'It&rsquo;s a tie!': 'Tỉ số hòa!',
  'Level:': 'Cấp độ:',
  'Listen to pronunciation': 'Hãy nghe phát âm',
  'no letters were placed.': 'không có chữ nào được sử dụng.',
  'not found': 'chưa có định nghĩa từ',
  'OK': 'OK',
  'Pass': 'Bỏ Lượt',
  'Play Again': 'Chơi Lại',
  'Play': 'Chơi',
  'Select the letters you want to swap': 'Chọn những chữ bạn muốn đổi',
  'Show computer&rsquo;s rack': 'Hiện khay chữ của máy',
  'Show definition': 'Hiển thị định nghĩa',
  'Sorry, ': 'Xin lỗi, ',
  'Sorry, no tiles left to swap.': 'Xin lỗi, không còn chữ nào để đổi.',
  'Sorry, this browser is not supported. Please upgrade to a modern browser.': 'Xin lỗi, trình duyệt này không được hỗ trợ. Vui lòng nâng cấp trình duyệt.',
  'spaces in word.': 'khoảng trống trong từ.',
  'Swap': 'Đổi Chữ',
  'This will restart the game.': 'Trò chơi sẽ khởi động lại.',
  'Tiles left:': 'Số chữ còn lại:',
  'Tileset:': 'Bộ chữ:',
  'Vietnamese': 'Tiếng Việt',
  'Word definitions not enabled.': 'Không có định nghĩa từ.',
  'word is not connected.': 'từ không được kết nối.',
  'word must be horizontal or vertical.': 'từ phải xếp hàng ngang hoặc dọc.',
  'Words Played': 'Những Từ Đã Chơi',
  'You win!': 'Bạn thắng!',
  'You: ': 'Bạn: ',
  'Your last score:': 'Điểm lượt cuối của bạn:',
  'Your total score:': 'Tổng điểm của bạn:'
};

function t(str) {
  return translation_map[str] || str;
}