@echo off
setlocal
set target=play
AjaxMin.exe -clobber css\style.css css\submodal.css -out %target%\css\styles.min.css
AjaxMin.exe -inline:no -clobber -term lang\vi_wordlist.js lang\vi_defs.js lang\vi_letters.js src\submodal.js src\redipsdrag.js src\bonuses.js src\ui.js src\engine.js src\events.js -out %target%\js\app.min.js
copy /y index.html %target%
xcopy /y lang\en_translate.js %target%\lang\
xcopy /y lang\vi_translate.js %target%\lang\
xcopy /iy pics %target%\pics
xcopy /iy sounds %target%\sounds
fart -C %target%\index.html --remove "<link rel=\"stylesheet\" href=\"css/style.css\">\n"
fart %target%\index.html submodal.css styles.min.css
fart -C %target%\index.html --remove "<script src=\"src/submodal.js\"></script>\n"
fart -C %target%\index.html --remove "<script src=\"lang/vi_wordlist.js\"></script>\n"
fart -C %target%\index.html --remove "<script src=\"lang/vi_defs.js\"></script>\n"
fart -C %target%\index.html --remove "<script src=\"lang/vi_letters.js\"></script>\n"
fart -C %target%\index.html --remove "<script src=\"lang/vi_translate.js\"></script>\n"
fart -C %target%\index.html --remove "<script src=\"src/redipsdrag.js\"></script>\n"
fart -C %target%\index.html --remove "<script src=\"src/bonuses.js\"></script>\n"
fart -C %target%\index.html --remove "<script src=\"src/ui.js\"></script>\n"
fart -C %target%\index.html --remove "<script src=\"src/engine.js\"></script>\n"
fart %target%\index.html src/events.js js/app.min.js
endlocal