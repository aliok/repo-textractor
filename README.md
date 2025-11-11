```shell
pyenv install 3.11.9
pyenv local 3.11.9
pyenv which python
$(pyenv which python) -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

```shell
pip install flask requests

pip freeze > requirements.txt
```
